//! Big & old files, and duplicate finder.

use crate::core::{self, ActionResult, Progress, RemovalRequest};
use crate::history;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub size: u64,
    pub modified: u64,
}

const MIN_BIG: u64 = 5 * 1024 * 1024;

fn walk_files(roots: &[PathBuf], min: u64, progress: &Progress, mut f: impl FnMut(&Path, u64, u64)) {
    let protected: Vec<PathBuf> = [core::home().join("AppData"), core::home().join("Saved Games")]
        .into_iter()
        .chain(dirs::document_dir().map(|d| d.join("My Games")))
        .collect();
    let mut seen = HashSet::new();
    for root in roots {
        if !seen.insert(root.display().to_string().to_lowercase()) {
            continue;
        }
        let it = walkdir::WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && (n == "node_modules" || n == ".git" || protected.iter().any(|p| core::same_path(e.path(), p))))
        });
        for e in it.flatten() {
            if core::cancelled() {
                return;
            }
            if !e.file_type().is_file() {
                continue;
            }
            let Ok(md) = e.metadata() else { continue };
            progress.add(e.path(), md.len());
            if md.len() >= min && !core::is_excluded(e.path()) {
                f(e.path(), md.len(), md.modified().map(core::secs).unwrap_or(0));
            }
        }
    }
}

fn entry(p: &Path, size: u64, modified: u64) -> FileEntry {
    FileEntry {
        path: p.display().to_string(),
        name: core::file_name(p),
        folder: p.parent().map(|x| x.display().to_string()).unwrap_or_default(),
        size,
        modified,
    }
}

/// Every file >= 5 MB in the personal folders. The UI filters by size/age/type.
pub fn large_scan(app: Option<AppHandle>) -> Vec<FileEntry> {
    let progress = Progress::new(app, crate::l10n::tr("Looking for big & old files", "Op zoek naar grote en oude bestanden"));
    let mut out = vec![];
    walk_files(&core::personal_folders(), MIN_BIG, &progress, |p, s, m| out.push(entry(p, s, m)));
    out.sort_by_key(|f| std::cmp::Reverse(f.size));
    out
}

const VIDEO_EXT: [&str; 6] = ["mp4", "mkv", "mov", "webm", "avi", "flv"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipsSummary {
    pub count: u64,
    pub size: u64,
    pub folder: String,
}

/// Game Bar, ShadowPlay, ReLive and OBS all record into the Videos folder.
pub fn clips_summary() -> ClipsSummary {
    let Some(videos) = dirs::video_dir() else { return ClipsSummary { count: 0, size: 0, folder: String::new() } };
    let (mut count, mut size) = (0, 0);
    for e in walkdir::WalkDir::new(&videos).follow_links(false).into_iter().flatten() {
        let is_video = e.path().extension().is_some_and(|x| VIDEO_EXT.iter().any(|v| x.eq_ignore_ascii_case(v)));
        if e.file_type().is_file() && is_video {
            if let Ok(m) = e.metadata() {
                count += 1;
                size += m.len();
            }
        }
    }
    ClipsSummary { count, size, folder: videos.display().to_string() }
}

pub fn trash_files(paths: Vec<String>, tool: &str) -> ActionResult {
    let reqs = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_file() || p.is_dir())
        .map(|p| {
            let size = core::measure(&p, None).size;
            RemovalRequest { path: p, size, permanent: false }
        })
        .collect();
    let mut out = core::remove(reqs, &core::is_user_trashable);
    history::record(tool, out.history);
    out.result.message = core::summary(&out.result);
    out.result
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupFile {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub modified: u64,
    pub keep: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub id: String,
    pub size: u64,
    pub wasted: u64,
    pub files: Vec<DupFile>,
}

pub fn default_dup_roots() -> Vec<String> {
    core::personal_folders().iter().map(|p| p.display().to_string()).collect()
}

fn hash(p: &Path, limit: Option<u64>) -> Option<String> {
    let f = File::open(p).ok()?;
    let mut r: Box<dyn Read> = match limit {
        Some(l) => Box::new(f.take(l)),
        None => Box::new(f),
    };
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        if core::cancelled() {
            return None;
        }
        let n = r.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(format!("{:x}", h.finalize()))
}

/// (volume serial, file index) so hard links to the same data aren't reported.
#[cfg(windows)]
fn file_id(p: &Path) -> Option<(u32, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let f = File::open(p).ok()?;
    unsafe {
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        if GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) == 0 {
            return None;
        }
        Some((info.dwVolumeSerialNumber, ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64))
    }
}
#[cfg(not(windows))]
fn file_id(_p: &Path) -> Option<(u32, u64)> {
    None
}

pub fn dup_scan(app: Option<AppHandle>, roots: Vec<String>) -> Vec<DupGroup> {
    let progress = Progress::new(app, crate::l10n::tr("Indexing files", "Bestanden indexeren"));
    let roots: Vec<PathBuf> = roots.into_iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    let mut by_size: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
    walk_files(&roots, 1024 * 1024, &progress, |p, s, m| by_size.entry(s).or_default().push((p.to_path_buf(), m)));

    progress.set_phase(crate::l10n::tr("Comparing contents", "Inhoud vergelijken"));
    let mut groups = vec![];
    for (size, files) in by_size.into_iter().filter(|(_, v)| v.len() > 1) {
        if core::cancelled() {
            break;
        }
        // Drop hard links of the same file.
        let mut ids = HashSet::new();
        let files: Vec<_> = files.into_iter().filter(|(p, _)| file_id(p).map(|id| ids.insert(id)).unwrap_or(true)).collect();
        let mut partial: HashMap<String, Vec<(PathBuf, u64)>> = HashMap::new();
        for (p, m) in files {
            progress.add(&p, 0);
            if let Some(h) = hash(&p, Some(64 * 1024)) {
                partial.entry(h).or_default().push((p, m));
            }
        }
        for (_, cands) in partial.into_iter().filter(|(_, v)| v.len() > 1) {
            let mut full: HashMap<String, Vec<(PathBuf, u64)>> = HashMap::new();
            for (p, m) in cands {
                let h = if size <= 64 * 1024 { hash(&p, Some(64 * 1024)) } else { hash(&p, None) };
                if let Some(h) = h {
                    full.entry(h).or_default().push((p, m));
                }
            }
            for (digest, mut same) in full.into_iter().filter(|(_, v)| v.len() > 1) {
                same.sort_by_key(|f| std::cmp::Reverse(f.1));
                let wasted = size * (same.len() as u64 - 1);
                let files = same
                    .into_iter()
                    .enumerate()
                    .map(|(i, (p, m))| {
                        let e = entry(&p, size, m);
                        DupFile { path: e.path, name: e.name, folder: e.folder, modified: m, keep: i == 0 }
                    })
                    .collect();
                groups.push(DupGroup { id: digest, size, wasted, files });
            }
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.wasted));
    groups
}

/// Trash duplicates. Groups are re-verified here by full content hash: a file is only
/// removed if an identical, unselected copy remains (or, if all were selected, the newest is kept).
pub fn dup_trash(groups: Vec<Vec<String>>, selected: Vec<String>) -> ActionResult {
    let sel: HashSet<String> = selected.into_iter().collect();
    let mut chosen = vec![];
    for g in groups {
        let mut by_hash: HashMap<String, Vec<(String, u64)>> = HashMap::new();
        for p in g {
            let path = Path::new(&p);
            let Ok(md) = std::fs::metadata(path) else { continue };
            if !md.is_file() {
                continue;
            }
            if let Some(h) = hash(path, None) {
                by_hash.entry(format!("{}:{h}", md.len())).or_default().push((p, md.modified().map(core::secs).unwrap_or(0)));
            }
        }
        chosen.extend(by_hash.into_values().flat_map(|class| pick_deletable(class, &sel)));
    }
    trash_files(chosen, "duplicates")
}

/// From one set of identical files, the selected ones that may go while at least one copy stays.
fn pick_deletable(mut class: Vec<(String, u64)>, sel: &HashSet<String>) -> Vec<String> {
    if class.len() < 2 {
        return vec![];
    }
    class.sort_by_key(|f| std::cmp::Reverse(f.1));
    let keeps_one = class.iter().any(|(p, _)| !sel.contains(p));
    class.into_iter().enumerate().filter(|(i, (p, _))| sel.contains(p) && (keeps_one || *i > 0)).map(|(_, (p, _))| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_keeps_one_copy() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<HashSet<_>>();
        let class = vec![("new".to_string(), 3), ("mid".to_string(), 2), ("old".to_string(), 1)];
        let mut all = pick_deletable(class.clone(), &s(&["new", "mid", "old"]));
        all.sort();
        assert_eq!(all, vec!["mid", "old"]);
        assert_eq!(pick_deletable(class.clone(), &s(&["old"])), vec!["old"]);
        assert!(pick_deletable(vec![("only".into(), 1)], &s(&["only"])).is_empty());
    }

    #[test]
    fn rejects_files_that_differ() {
        let dir = std::env::temp_dir().join(format!("wincleaner-dup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a"), b"same").unwrap();
        std::fs::write(dir.join("b"), b"diff").unwrap();
        let a = hash(&dir.join("a"), None).unwrap();
        let b = hash(&dir.join("b"), None).unwrap();
        assert_ne!(a, b);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
