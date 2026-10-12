//! Shared plumbing: paths, safety rules, removal, progress reporting and Windows helpers.

use crate::history::HistoryItem;
use crate::prefs;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Jobs & progress
// ---------------------------------------------------------------------------

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn begin_job() {
    CANCEL.store(false, Ordering::SeqCst);
}
pub fn cancel_job() {
    CANCEL.store(true, Ordering::SeqCst);
}
pub fn cancelled() -> bool {
    CANCEL.load(Ordering::Relaxed)
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProgressState {
    pub phase: String,
    pub current: String,
    pub bytes: u64,
    pub items: u64,
}

pub struct Progress {
    app: Option<AppHandle>,
    inner: Mutex<(Instant, ProgressState)>,
}

impl Progress {
    pub fn new(app: Option<AppHandle>, phase: &str) -> Self {
        let p = Progress {
            app,
            inner: Mutex::new((Instant::now(), ProgressState::default())),
        };
        p.set_phase(phase);
        p
    }

    pub fn set_phase(&self, phase: &str) {
        let mut g = self.inner.lock().unwrap();
        g.1.phase = phase.to_string();
        g.1.current.clear();
        if let Some(app) = &self.app {
            let _ = app.emit("progress", g.1.clone());
        }
    }

    pub fn add(&self, path: &Path, bytes: u64) {
        let mut g = self.inner.lock().unwrap();
        g.1.items += 1;
        g.1.bytes += bytes;
        if g.0.elapsed() >= Duration::from_millis(120) {
            g.0 = Instant::now();
            g.1.current = path.display().to_string();
            if let Some(app) = &self.app {
                let _ = app.emit("progress", g.1.clone());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Well-known locations
// ---------------------------------------------------------------------------

fn env_dir(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(fallback))
}

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| env_dir("USERPROFILE", r"C:\Users\Default"))
}
pub fn local() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| home().join(r"AppData\Local"))
}
pub fn roaming() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| home().join(r"AppData\Roaming"))
}
pub fn local_low() -> PathBuf {
    home().join(r"AppData\LocalLow")
}
pub fn program_data() -> PathBuf {
    env_dir("ProgramData", r"C:\ProgramData")
}
pub fn windir() -> PathBuf {
    env_dir("SystemRoot", r"C:\Windows")
}
pub fn system_drive() -> PathBuf {
    let d = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    PathBuf::from(format!("{d}\\"))
}
pub fn program_files() -> Vec<PathBuf> {
    vec![
        env_dir("ProgramFiles", r"C:\Program Files"),
        env_dir("ProgramFiles(x86)", r"C:\Program Files (x86)"),
    ]
}

/// The user's personal folders (may be redirected to OneDrive or another drive).
pub fn personal_folders() -> Vec<PathBuf> {
    [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn app_dir() -> PathBuf {
    let d = roaming().join("WinCleaner for Gamers");
    let _ = fs::create_dir_all(&d);
    d
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
pub fn secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string())
}

pub fn format_bytes(b: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{b} B") } else { format!("{v:.1} {}", U[i]) }
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

pub struct Measure {
    pub size: u64,
    pub newest: u64,
}

/// Total size and newest modification time of a file or folder. Never follows
/// symlinks or junctions (Rust treats junctions as symlinks on Windows).
pub fn measure(path: &Path, progress: Option<&Progress>) -> Measure {
    let mut m = Measure { size: 0, newest: 0 };
    let Ok(md) = fs::symlink_metadata(path) else { return m };
    m.newest = md.modified().map(secs).unwrap_or(0);
    if md.file_type().is_symlink() {
        return m;
    }
    if md.is_file() {
        m.size = md.len();
        if let Some(p) = progress {
            p.add(path, m.size);
        }
        return m;
    }
    for e in walkdir::WalkDir::new(path).follow_links(false).min_depth(1).into_iter().flatten() {
        if cancelled() {
            break;
        }
        if let Ok(md) = e.metadata() {
            let t = md.modified().map(secs).unwrap_or(0);
            if t > m.newest {
                m.newest = t;
            }
            if md.is_file() {
                m.size += md.len();
                if let Some(p) = progress {
                    p.add(e.path(), md.len());
                }
            }
        }
    }
    m
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/// Resolve the parent directory only, so a link *inside* an allowed folder that
/// points elsewhere is judged (and removed) as the link itself, never its target.
pub fn canon(p: &Path) -> PathBuf {
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) => dunce::canonicalize(parent).map(|c| c.join(name)).unwrap_or_else(|_| p.to_path_buf()),
        _ => dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()),
    }
}

fn key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\").to_lowercase();
    s.trim_end_matches('\\').to_string()
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    key(&canon(a)) == key(&canon(b))
}

fn root_key(root: &Path) -> String {
    key(&dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()))
}

/// True when `child` is strictly below `root` (never equal to it).
pub fn strictly_inside(child: &Path, root: &Path) -> bool {
    let c = key(&canon(child));
    let r = root_key(root);
    c.len() > r.len() + 1 && c.starts_with(&r) && c.as_bytes()[r.len()] == b'\\'
}

pub fn inside_or_equal(child: &Path, root: &Path) -> bool {
    key(&canon(child)) == root_key(root) || strictly_inside(child, root)
}

/// True when `child`'s direct parent is `root`.
pub fn direct_child(child: &Path, root: &Path) -> bool {
    match canon(child).parent() {
        Some(parent) => key(parent) == root_key(root),
        None => false,
    }
}

/// "Never touch" list: a path is excluded if it is, is inside, or contains an excluded path.
pub fn is_excluded(p: &Path) -> bool {
    let c = key(&canon(p));
    prefs::get().excluded.iter().any(|ex| {
        let e = key(Path::new(ex));
        !e.is_empty() && (c == e || c.starts_with(&format!("{e}\\")) || e.starts_with(&format!("{c}\\")))
    })
}

/// Folders that hold game saves, credentials or app state. Nothing in here is
/// ever offered for deletion by the file tools.
fn protected_user_areas() -> Vec<PathBuf> {
    let h = home();
    let mut v = vec![
        h.join("AppData"),
        h.join(".ssh"),
        h.join(".gnupg"),
        h.join("Saved Games"),
    ];
    if let Some(d) = dirs::document_dir() {
        v.push(d.join("My Games"));
        v.push(d.join("Rockstar Games"));
        v.push(d.join("Electronic Arts"));
    }
    v
}

/// Files the user can send to the Recycle Bin from Big Files, Duplicates and Disk Map.
pub fn is_user_trashable(p: &Path) -> bool {
    if is_excluded(p) {
        return false;
    }
    let mut roots = vec![home()];
    roots.extend(personal_folders());
    if !roots.iter().any(|r| strictly_inside(p, r)) {
        return is_secondary_drive_item(p);
    }
    if roots.iter().any(|r| same_path(p, r)) || protected_user_areas().iter().any(|a| inside_or_equal(p, a)) {
        return false;
    }
    // Keep top-level profile folders (Desktop, Documents, OneDrive, Contacts...) themselves.
    !direct_child(p, &home()) || canon(p).is_file()
}

/// Items on a non-system drive, at least two levels deep, outside OS folders.
fn is_secondary_drive_item(p: &Path) -> bool {
    let c = canon(p);
    let s = key(&c);
    if s.starts_with(&key(&system_drive())) || s.starts_with("\\\\") {
        return false;
    }
    let parts: Vec<&str> = s.split('\\').filter(|x| !x.is_empty()).collect();
    if parts.len() < 3 {
        return false;
    }
    const BLOCK: [&str; 8] = [
        "$recycle.bin", "system volume information", "windows", "program files",
        "program files (x86)", "programdata", "recovery", "boot",
    ];
    !BLOCK.contains(&parts[1])
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

pub struct RemovalRequest {
    pub path: PathBuf,
    pub size: u64,
    pub permanent: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub freed: u64,
    pub removed: u64,
    pub skipped: u64,
    pub failed: Vec<String>,
    pub message: String,
}

pub struct RemovalOutcome {
    pub result: ActionResult,
    pub history: Vec<HistoryItem>,
}

/// Remove validated paths. `allowed` is re-checked here, right before deletion.
pub fn remove(reqs: Vec<RemovalRequest>, allowed: &dyn Fn(&Path) -> bool) -> RemovalOutcome {
    let mut out = RemovalOutcome { result: ActionResult::default(), history: vec![] };
    for r in reqs {
        if !allowed(&r.path) || is_excluded(&r.path) {
            out.result.failed.push(format!("Blocked by safety rules: {}", r.path.display()));
            continue;
        }
        if r.permanent {
            let (freed, locked) = delete_tree(&r.path);
            out.result.freed += freed;
            out.result.skipped += locked;
            if freed > 0 || !r.path.exists() {
                out.result.removed += 1;
                out.history.push(HistoryItem::new(&r.path, freed, false));
            }
        } else {
            match trash::delete(&r.path) {
                Ok(_) => {
                    out.result.freed += r.size;
                    out.result.removed += 1;
                    out.history.push(HistoryItem::new(&r.path, r.size, true));
                }
                Err(e) => out.result.failed.push(format!("{}: {e}", r.path.display())),
            }
        }
    }
    out
}

/// Best-effort permanent delete: removes everything not locked by a running
/// program. Links/junctions are removed as links, never followed.
/// Returns (bytes freed, files that were in use).
pub fn delete_tree(p: &Path) -> (u64, u64) {
    let mut freed = 0;
    let mut locked = 0;
    del(p, &mut freed, &mut locked);
    (freed, locked)
}

fn del(p: &Path, freed: &mut u64, locked: &mut u64) {
    let Ok(md) = fs::symlink_metadata(p) else { return };
    if md.file_type().is_symlink() {
        let _ = fs::remove_file(p).or_else(|_| fs::remove_dir(p));
        return;
    }
    if md.is_dir() {
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.flatten() {
                del(&e.path(), freed, locked);
            }
        }
        let _ = fs::remove_dir(p);
        return;
    }
    let len = md.len();
    match fs::remove_file(p) {
        Ok(_) => *freed += len,
        Err(_) => {
            let mut perm = md.permissions();
            if perm.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                if fs::set_permissions(p, perm).is_ok() && fs::remove_file(p).is_ok() {
                    *freed += len;
                    return;
                }
            }
            *locked += 1;
        }
    }
}

// ---------------------------------------------------------------------------
// Windows helpers
// ---------------------------------------------------------------------------

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Run a fixed system tool without flashing a console window.
/// Arguments are never built from untrusted input.
pub fn run(exe: &str, args: &[&str]) -> Result<(i32, String), String> {
    let mut cmd = Command::new(exe);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("Couldn't start {exe}: {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok((out.status.code().unwrap_or(-1), text))
}

#[cfg(windows)]
pub fn is_admin() -> bool {
    unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() != 0 }
}
#[cfg(not(windows))]
pub fn is_admin() -> bool {
    false
}

/// ShellExecuteEx so installers/uninstallers can raise their own UAC prompt.
/// Returns the exit code when `wait` is set.
#[cfg(windows)]
pub fn shell_execute(verb: &str, file: &str, params: &str, wait: bool) -> Result<Option<u32>, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb_w = wide(verb);
    let file_w = wide(file);
    let params_w = wide(params);
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb_w.as_ptr();
        info.lpFile = file_w.as_ptr();
        info.lpParameters = if params.is_empty() { std::ptr::null() } else { params_w.as_ptr() };
        info.nShow = SW_SHOWNORMAL;
        if ShellExecuteExW(&mut info) == 0 {
            let err = GetLastError();
            return Err(if err == 1223 { "Cancelled at the Windows permission prompt.".into() } else { format!("Windows error {err}") });
        }
        if info.hProcess.is_null() {
            return Ok(None);
        }
        let mut code = None;
        if wait {
            WaitForSingleObject(info.hProcess, INFINITE);
            let mut c = 0u32;
            if GetExitCodeProcess(info.hProcess, &mut c) != 0 {
                code = Some(c);
            }
        }
        CloseHandle(info.hProcess);
        Ok(code)
    }
}
#[cfg(not(windows))]
pub fn shell_execute(_verb: &str, _file: &str, _params: &str, _wait: bool) -> Result<Option<u32>, String> {
    Err("Windows only".into())
}

/// Lowercased names of running executables.
pub fn running_processes() -> std::collections::HashSet<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().map(|p| p.name().to_string_lossy().to_lowercase()).collect()
}
