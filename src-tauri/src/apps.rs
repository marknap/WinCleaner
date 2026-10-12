//! Installed programs (from the registry), uninstalling them, and their leftovers
//! (folders and registry keys).

use crate::core::{self, ActionResult, RemovalRequest};
use crate::l10n::tr;
use crate::prefs::{self, RecentUninstall};
use crate::{diag, history, trf};
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub size: u64,
    pub install_date: String,
    pub location: String,
    pub is_game: bool,
    pub machine_wide: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    pub path: String,
    pub size: u64,
    pub personal: bool,
    /// "folder" or "registry".
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallResult {
    pub still_installed: bool,
    pub message: String,
    pub leftovers: Vec<Leftover>,
}

struct Raw {
    app: InstalledApp,
    uninstall: String,
}

const GAME_HINTS: [&str; 10] = [
    "steamapps", "epic games", "gog galaxy", "gog games", "riot games", "ubisoft game launcher", "ea games", "battle.net", "xboxgames", "games\\",
];

#[cfg(windows)]
fn read_registry() -> Vec<Raw> {
    use winreg::enums::*;
    use winreg::RegKey;
    const PATH: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
    const PATH32: &str = "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
    let sources = [
        ("HKLM64", RegKey::predef(HKEY_LOCAL_MACHINE), PATH, true),
        ("HKLM32", RegKey::predef(HKEY_LOCAL_MACHINE), PATH32, true),
        ("HKCU", RegKey::predef(HKEY_CURRENT_USER), PATH, false),
    ];
    let mut out: Vec<Raw> = vec![];
    for (tag, hive, path, machine) in sources {
        let Ok(root) = hive.open_subkey_with_flags(path, KEY_READ) else { continue };
        for sub in root.enum_keys().flatten() {
            let Ok(k) = root.open_subkey(&sub) else { continue };
            let s = |n: &str| k.get_value::<String, _>(n).unwrap_or_default();
            let d = |n: &str| k.get_value::<u32, _>(n).unwrap_or(0);
            let name = s("DisplayName");
            let uninstall = {
                let u = s("UninstallString");
                if u.is_empty() { s("QuietUninstallString") } else { u }
            };
            if name.trim().is_empty() || uninstall.is_empty() || d("SystemComponent") == 1 || !s("ParentKeyName").is_empty() {
                continue;
            }
            let rt = s("ReleaseType").to_lowercase();
            if rt.contains("update") || rt.contains("hotfix") {
                continue;
            }
            let location = s("InstallLocation").trim_matches('"').to_string();
            let lower = format!("{} {} {}", location.to_lowercase(), s("Publisher").to_lowercase(), uninstall.to_lowercase());
            let app = InstalledApp {
                id: format!("{tag}|{sub}"),
                publisher: s("Publisher"),
                version: s("DisplayVersion"),
                size: d("EstimatedSize") as u64 * 1024,
                install_date: s("InstallDate"),
                is_game: GAME_HINTS.iter().any(|h| lower.contains(h)),
                machine_wide: machine,
                name,
                location,
            };
            if !out.iter().any(|r| r.app.name == app.name && r.app.version == app.version) {
                out.push(Raw { app, uninstall });
            }
        }
    }
    out
}
#[cfg(not(windows))]
fn read_registry() -> Vec<Raw> {
    vec![]
}

pub fn list() -> Vec<InstalledApp> {
    let mut apps: Vec<InstalledApp> = read_registry().into_iter().map(|r| r.app).collect();
    apps.par_iter_mut().filter(|a| a.size == 0 && !a.location.is_empty()).for_each(|a| {
        let p = Path::new(&a.location);
        if p.is_dir() && p.components().count() > 2 {
            a.size = core::measure(p, None).size;
        }
    });
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

/// Games installed through Battle.net (their uninstaller is the Battle.net launcher).
pub fn battlenet_entries() -> Vec<InstalledApp> {
    read_registry()
        .into_iter()
        .filter(|r| {
            let u = r.uninstall.to_lowercase();
            u.contains("battle.net launcher.exe") || (u.contains("battle.net") && u.contains("--uid="))
        })
        .filter(|r| !r.app.name.eq_ignore_ascii_case("battle.net"))
        .map(|r| r.app)
        .collect()
}

/// Split a registry UninstallString into executable + arguments.
fn split_command(cmd: &str) -> (String, String) {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return (rest[..end].to_string(), rest[end + 1..].trim().to_string());
        }
    }
    let lower = cmd.to_lowercase();
    if let Some(i) = lower.find(".exe") {
        return (cmd[..i + 4].to_string(), cmd[i + 4..].trim().to_string());
    }
    match cmd.split_once(' ') {
        Some((a, b)) => (a.to_string(), b.trim().to_string()),
        None => (cmd.to_string(), String::new()),
    }
}

/// Run the program's own uninstaller (read from the registry, never from the UI),
/// then look for leftovers.
pub fn uninstall(id: &str) -> Result<UninstallResult, String> {
    let raw = read_registry().into_iter().find(|r| r.app.id == id).ok_or(tr("That program is no longer installed.", "Dat programma is niet meer geïnstalleerd."))?;
    let (exe, mut args) = split_command(&raw.uninstall);
    let exe_name = core::file_name(Path::new(&exe)).to_lowercase();
    let exe = if exe_name == "msiexec.exe" || exe_name == "msiexec" {
        // Force uninstall rather than "change/repair".
        args = args.replace("/I{", "/X{").replace("/i{", "/X{");
        "msiexec.exe".to_string()
    } else {
        exe
    };
    diag::info(format!("Uninstalling {} via {exe}", raw.app.name));
    core::shell_execute("open", &exe, &args, true)?;

    // Some uninstallers hand off to a helper and exit immediately; give them time.
    let mut still = true;
    for _ in 0..60 {
        still = read_registry().iter().any(|r| r.app.id == id);
        if !still {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    if !still {
        prefs::add_recent_uninstall(RecentUninstall {
            name: raw.app.name.clone(),
            publisher: raw.app.publisher.clone(),
            location: raw.app.location.clone(),
            date: core::now_secs(),
        });
    }
    let leftovers = find_leftovers(&raw.app);
    Ok(UninstallResult {
        message: if still {
            trf!("{} still looks installed. If its uninstaller is still open, finish it first.", "{} lijkt nog geïnstalleerd. Rond eerst het verwijderprogramma af als dat nog openstaat.", raw.app.name)
        } else {
            trf!("{} uninstalled", "{} verwijderd", raw.app.name)
        },
        still_installed: still,
        leftovers,
    })
}

/// Read-only preview of what would likely remain, before uninstalling.
pub fn preview_leftovers(id: &str) -> Result<Vec<Leftover>, String> {
    let raw = read_registry().into_iter().find(|r| r.app.id == id).ok_or(tr("That program is no longer installed.", "Dat programma is niet meer geïnstalleerd."))?;
    Ok(find_leftovers(&raw.app))
}

pub fn recent_leftovers(name: &str) -> Result<Vec<Leftover>, String> {
    let r = prefs::get().recent_uninstalls.into_iter().find(|r| r.name == name).ok_or(tr("Not found.", "Niet gevonden."))?;
    let app = InstalledApp {
        id: String::new(),
        name: r.name,
        publisher: r.publisher,
        version: String::new(),
        size: 0,
        install_date: String::new(),
        location: r.location,
        is_game: false,
        machine_wide: false,
    };
    Ok(find_leftovers(&app))
}

fn leftover_roots() -> Vec<(PathBuf, bool)> {
    let mut v = vec![(core::roaming(), true), (core::local(), false), (core::local_low(), true), (core::program_data(), false)];
    v.extend(core::program_files().into_iter().map(|p| (p, false)));
    v
}

const SHARED_NAMES: [&str; 30] = [
    "microsoft", "windows", "common files", "packages", "temp", "programs", "intel", "nvidia", "nvidia corporation",
    "amd", "google", "mozilla", "apple", "adobe", "steam", "epic games", "valve", "unity", "unreal engine", "crashdumps",
    "windowsapps", "package cache", "classes", "policies", "wow6432node", "clients", "registeredapplications", "odbc",
    "microsoft corporation", "software",
];

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn is_shared(name: &str) -> bool {
    let n = norm(name);
    SHARED_NAMES.iter().any(|s| norm(s) == n)
}

/// Name variants used to match leftovers, e.g. "Foo Bar 2.3 (x64)" -> "foobar23x64", "foobar".
fn name_keys(name: &str) -> Vec<String> {
    let mut keys = vec![norm(name)];
    let trimmed: String = name
        .split(['(', '-'])
        .next()
        .unwrap_or("")
        .split_whitespace()
        .filter(|w| !w.chars().next().is_some_and(|c| c.is_ascii_digit() || c == 'v' && w.len() > 1 && w[1..].starts_with(|d: char| d.is_ascii_digit())))
        .collect::<Vec<_>>()
        .join(" ");
    keys.push(norm(&trimmed));
    keys.sort();
    keys.dedup();
    keys.retain(|k| k.len() >= 4 && !SHARED_NAMES.iter().any(|s| norm(s) == *k));
    keys
}

pub fn find_leftovers(app: &InstalledApp) -> Vec<Leftover> {
    let keys = name_keys(&app.name);
    let publisher = norm(&app.publisher);
    let mut hits: Vec<(PathBuf, bool)> = vec![];
    for (root, personal) in leftover_roots() {
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let n = norm(&e.file_name().to_string_lossy());
            if keys.contains(&n) {
                hits.push((e.path(), personal));
            } else if publisher.len() >= 4 && n == publisher && !is_shared(&n) {
                if let Ok(rd2) = fs::read_dir(e.path()) {
                    for e2 in rd2.flatten() {
                        if e2.path().is_dir() && keys.contains(&norm(&e2.file_name().to_string_lossy())) {
                            hits.push((e2.path(), personal));
                        }
                    }
                }
            }
        }
    }
    if !app.location.is_empty() {
        let p = PathBuf::from(&app.location);
        if p.is_dir() && is_leftover_path(&p) && !hits.iter().any(|(h, _)| core::same_path(h, &p)) {
            hits.push((p, false));
        }
    }
    let mut out: Vec<Leftover> = hits
        .into_par_iter()
        .filter(|(p, _)| !core::is_excluded(p))
        .map(|(p, personal)| Leftover { size: core::measure(&p, None).size, path: p.display().to_string(), personal, kind: "folder".into() })
        .collect();
    out.extend(registry_leftovers(&keys, &publisher));
    out
}

/// Leftovers must sit one or two levels inside a known app-data / program folder.
pub fn is_leftover_path(p: &Path) -> bool {
    leftover_roots().iter().any(|(root, _)| {
        core::direct_child(p, root) && !is_shared(&core::file_name(p))
            || p.parent().is_some_and(|parent| core::direct_child(parent, root) && !is_shared(&core::file_name(parent)))
    })
}

// ---------------------------------------------------------------------------
// Registry leftovers
// ---------------------------------------------------------------------------

const REG_ROOTS: [(&str, &str); 3] = [("HKCU", "Software"), ("HKLM", "SOFTWARE"), ("HKLM", "SOFTWARE\\WOW6432Node")];

#[cfg(windows)]
fn hive(tag: &str) -> winreg::RegKey {
    use winreg::enums::*;
    winreg::RegKey::predef(if tag == "HKCU" { HKEY_CURRENT_USER } else { HKEY_LOCAL_MACHINE })
}

#[cfg(windows)]
fn registry_leftovers(keys: &[String], publisher: &str) -> Vec<Leftover> {
    let mut out = vec![];
    let push = |out: &mut Vec<Leftover>, p: String| {
        if !out.iter().any(|l: &Leftover| l.path.eq_ignore_ascii_case(&p)) {
            out.push(Leftover { path: p, size: 0, personal: true, kind: "registry".into() });
        }
    };
    for (tag, root) in REG_ROOTS {
        let Ok(r) = hive(tag).open_subkey(root) else { continue };
        for name in r.enum_keys().flatten() {
            if is_shared(&name) {
                continue;
            }
            let n = norm(&name);
            if keys.contains(&n) {
                push(&mut out, format!("{tag}\\{root}\\{name}"));
            } else if publisher.len() >= 4 && n == publisher {
                if let Ok(pk) = r.open_subkey(&name) {
                    for sub in pk.enum_keys().flatten() {
                        if keys.contains(&norm(&sub)) {
                            push(&mut out, format!("{tag}\\{root}\\{name}\\{sub}"));
                        }
                    }
                }
            }
        }
    }
    out
}
#[cfg(not(windows))]
fn registry_leftovers(_keys: &[String], _publisher: &str) -> Vec<Leftover> {
    vec![]
}

/// "HKCU\Software\X" or "HKCU\Software\X\Y" (also HKLM, optionally under WOW6432Node),
/// where X and Y aren't shared vendor keys. Returns (hive, root, rest).
fn parse_registry_leftover(p: &str) -> Option<(&'static str, &'static str, String)> {
    // Longest root first so WOW6432Node wins over SOFTWARE.
    let mut roots = REG_ROOTS.to_vec();
    roots.sort_by_key(|(_, r)| std::cmp::Reverse(r.len()));
    for (tag, root) in roots {
        let prefix = format!("{tag}\\{root}\\");
        if p.len() > prefix.len() && p[..prefix.len()].eq_ignore_ascii_case(&prefix) {
            let rest = &p[prefix.len()..];
            let parts: Vec<&str> = rest.split('\\').collect();
            let ok = (1..=2).contains(&parts.len()) && parts.iter().all(|x| !x.is_empty() && !is_shared(x) && norm(x).len() >= 4);
            return ok.then(|| (tag, root, rest.to_string()));
        }
    }
    None
}

#[cfg(windows)]
fn delete_registry_leftover(path: &str) -> Result<history::HistoryItem, String> {
    let (tag, root, rest) = parse_registry_leftover(path).ok_or_else(|| trf!("Blocked by safety rules: {}", "Geblokkeerd door veiligheidsregels: {}", path))?;
    if tag == "HKLM" && !core::is_admin() {
        return Err(trf!("{} needs admin rights.", "{} heeft beheerdersrechten nodig.", path));
    }
    let dir = core::app_dir().join("registry-backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = rest.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
    let backup = dir.join(format!("{}-{tag}-{safe}.reg", core::now_secs()));
    let reg = core::windir().join(r"System32\reg.exe").display().to_string();
    let full = format!("{tag}\\{root}\\{rest}");
    match core::run(&reg, &["export", &full, &backup.display().to_string(), "/y"])? {
        (0, _) => {}
        (_, out) => return Err(trf!("Backup failed, nothing removed: {}", "Back-up mislukt, niets verwijderd: {}", out.trim())),
    }
    let base = hive(tag).open_subkey_with_flags(root, winreg::enums::KEY_ALL_ACCESS).map_err(|e| e.to_string())?;
    base.delete_subkey_all(&rest).map_err(|e| e.to_string())?;
    diag::info(format!("Removed registry key {full} (backup {})", backup.display()));
    Ok(history::HistoryItem { path: full, size: 0, recycled: false, restored: false, backup: Some(backup.display().to_string()) })
}
#[cfg(not(windows))]
fn delete_registry_leftover(_path: &str) -> Result<history::HistoryItem, String> {
    Err("Windows only".into())
}

pub fn trash_leftovers(paths: Vec<String>) -> ActionResult {
    let (reg, files): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| p.starts_with("HKCU\\") || p.starts_with("HKLM\\"));
    let reqs = files
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .map(|p| RemovalRequest { size: core::measure(&p, None).size, path: p, permanent: false })
        .collect();
    let mut out = core::remove(reqs, &is_leftover_path);
    for r in reg {
        match delete_registry_leftover(&r) {
            Ok(item) => {
                out.result.removed += 1;
                out.history.push(item);
            }
            Err(e) => out.result.failed.push(e),
        }
    }
    history::record("leftovers", out.history);
    out.result.message = core::summary(&out.result);
    out.result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_uninstall_commands() {
        assert_eq!(split_command(r#""C:\Program Files\App\unins000.exe" /SILENT"#), (r"C:\Program Files\App\unins000.exe".into(), "/SILENT".into()));
        assert_eq!(split_command(r"C:\Program Files\App\uninstall.exe --remove"), (r"C:\Program Files\App\uninstall.exe".into(), "--remove".into()));
        assert_eq!(split_command("MsiExec.exe /I{1234-ABCD}"), ("MsiExec.exe".into(), "/I{1234-ABCD}".into()));
    }

    #[test]
    fn name_variants() {
        let k = name_keys("Foo Bar 2.3.1 (x64)");
        assert!(k.contains(&"foobar".to_string()));
        // Too short or shared names never match.
        assert!(name_keys("Abc").is_empty());
        assert!(name_keys("Microsoft").is_empty());
    }

    #[test]
    fn registry_paths_are_restricted() {
        assert!(parse_registry_leftover(r"HKCU\Software\Discord").is_some());
        assert!(parse_registry_leftover(r"HKCU\Software\Vendor Inc\Some App").is_some());
        assert!(parse_registry_leftover(r"HKLM\SOFTWARE\WOW6432Node\SomeApp").is_some_and(|(_, r, rest)| r.contains("WOW") && rest == "SomeApp"));
        assert!(parse_registry_leftover(r"HKCU\Software\Microsoft").is_none());
        assert!(parse_registry_leftover(r"HKCU\Software\Classes\x").is_none());
        assert!(parse_registry_leftover(r"HKCU\Software\A\B\C").is_none());
        assert!(parse_registry_leftover(r"HKLM\SYSTEM\CurrentControlSet").is_none());
        assert!(parse_registry_leftover(r"HKCU\Software\").is_none());
    }
}
