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
    let progress = Progress::new(app, "Looking for big & old files");
    let mut out = vec![];
    walk_files(&core::personal_folders(), MIN_BIG, &progress, |p, s, m| out.push(entry(p, s, m)));
    out.sort_by(|a, b| b.size.cmp(&a.size));
    out
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
    out.result.message = crate::clean::summary(&out.result);
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
    let progress = Progress::new(app, "Indexing files");
    let roots: Vec<PathBuf> = roots.into_iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    let mut by_size: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
    walk_files(&roots, 1024 * 1024, &progress, |p, s, m| by_size.entry(s).or_default().push((p.to_path_buf(), m)));

    progress.set_phase("Comparing contents");
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
                same.sort_by(|a, b| b.1.cmp(&a.1));
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
    groups.sort_by(|a, b| b.wasted.cmp(&a.wasted));
    groups
}

/// Trash duplicates, always keeping at least one copy of every group.
pub fn dup_trash(groups: Vec<Vec<String>>, selected: Vec<String>) -> ActionResult {
    let sel: HashSet<String> = selected.into_iter().collect();
    let mut chosen = vec![];
    for g in groups {
        let picked: Vec<&String> = g.iter().filter(|p| sel.contains(*p)).collect();
        let survivors = g.iter().filter(|p| !sel.contains(*p) && Path::new(p).exists()).count();
        let take = if survivors == 0 { picked.len().saturating_sub(1) } else { picked.len() };
        chosen.extend(picked.into_iter().take(take).cloned());
    }
    trash_files(chosen, "Duplicates")
}
