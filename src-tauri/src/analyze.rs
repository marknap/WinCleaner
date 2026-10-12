//! Disk Map: folder-size tree for a drive or folder, shown as a treemap.

use crate::core::{self, ActionResult, Progress, RemovalRequest};
use crate::history;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

struct Node {
    name: String,
    size: u64,
    is_dir: bool,
    /// Non-zero for the "N smaller items" bucket.
    bucket: u64,
    children: Vec<Node>,
}

static TREE: Mutex<Option<(PathBuf, Node)>> = Mutex::new(None);
const SMALL: u64 = 1024 * 1024;

fn build(path: &Path, depth: usize, progress: &Progress) -> Node {
    let name = core::file_name(path);
    let Ok(rd) = fs::read_dir(path) else {
        return Node { name, size: 0, is_dir: true, bucket: 0, children: vec![] };
    };
    let entries: Vec<_> = rd.flatten().collect();
    let build_one = |e: &fs::DirEntry| -> Option<Node> {
        if core::cancelled() {
            return None;
        }
        let ft = e.file_type().ok()?;
        if ft.is_symlink() {
            return None;
        }
        if ft.is_dir() {
            Some(build(&e.path(), depth + 1, progress))
        } else {
            let len = e.metadata().ok()?.len();
            progress.add(&e.path(), len);
            Some(Node { name: e.file_name().to_string_lossy().into_owned(), size: len, is_dir: false, bucket: 0, children: vec![] })
        }
    };
    let nodes: Vec<Node> = if depth < 2 { entries.par_iter().filter_map(build_one).collect() } else { entries.iter().filter_map(build_one).collect() };
    let mut children = vec![];
    let (mut small_size, mut small_count) = (0u64, 0u64);
    for n in nodes {
        if n.size < SMALL {
            small_size += n.size;
            small_count += 1;
        } else {
            children.push(n);
        }
    }
    if small_count > 0 {
        children.push(Node { name: crate::trf!("{} smaller items", "{} kleinere items", small_count), size: small_size, is_dir: false, bucket: small_count, children: vec![] });
    }
    children.sort_by_key(|c| std::cmp::Reverse(c.size));
    Node { name, size: children.iter().map(|c| c.size).sum(), is_dir: true, bucket: 0, children }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildView {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub kind: String,
    pub bucket: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub root: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub children: Vec<ChildView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub path: String,
    pub name: String,
    pub free: u64,
    pub total: u64,
}

pub fn drives() -> Vec<Drive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut v: Vec<Drive> = disks
        .list()
        .iter()
        .map(|d| Drive {
            path: d.mount_point().display().to_string(),
            name: d.name().to_string_lossy().into_owned(),
            free: d.available_space(),
            total: d.total_space(),
        })
        .collect();
    v.sort_by(|a, b| a.path.cmp(&b.path));
    v.dedup_by(|a, b| a.path == b.path);
    v
}

fn kind(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "flv" | "m4v" => "video",
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "heic" | "tif" | "tiff" | "psd" | "raw" | "dds" => "image",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "wma" | "bank" | "wem" | "pck" => "audio",
        "zip" | "rar" | "7z" | "tar" | "gz" | "iso" | "img" | "cab" | "vhd" | "vhdx" => "archive",
        "exe" | "msi" | "dll" | "sys" | "appx" | "msix" => "app",
        "pak" | "vpk" | "ucas" | "utoc" | "forge" | "big" | "bin" | "dat" | "arc" | "bundle" | "assets" | "rpf" | "wad" => "game",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "odt" | "rtf" => "doc",
        "rs" | "js" | "ts" | "py" | "cs" | "cpp" | "c" | "h" | "java" | "go" | "json" | "xml" | "html" | "css" => "code",
        _ => "other",
    }
}

fn view(root: &Path, path: &Path, node: &Node) -> NodeView {
    NodeView {
        root: root.display().to_string(),
        path: path.display().to_string(),
        name: if node.name.is_empty() { path.display().to_string() } else { node.name.clone() },
        size: node.size,
        children: node
            .children
            .iter()
            .map(|c| ChildView {
                name: c.name.clone(),
                path: if c.bucket > 0 { String::new() } else { path.join(&c.name).display().to_string() },
                size: c.size,
                is_dir: c.is_dir,
                kind: if c.bucket > 0 { "bucket".into() } else if c.is_dir { "folder".into() } else { kind(&c.name).into() },
                bucket: c.bucket,
            })
            .collect(),
    }
}

fn find<'a>(root: &Path, node: &'a mut Node, path: &Path) -> Option<&'a mut Node> {
    let rel = path.strip_prefix(root).ok()?;
    let mut cur = node;
    for comp in rel.components() {
        let name = comp.as_os_str().to_string_lossy();
        cur = cur.children.iter_mut().find(|c| c.is_dir && c.name == name)?;
    }
    Some(cur)
}

pub fn scan(app: Option<AppHandle>, root: String) -> Result<NodeView, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(crate::l10n::tr("That folder doesn't exist.", "Die map bestaat niet.").into());
    }
    let progress = Progress::new(app, crate::l10n::tr("Mapping your disk", "Je schijf in kaart brengen"));
    let node = build(&root, 0, &progress);
    if core::cancelled() {
        return Err(crate::l10n::tr("Cancelled", "Geannuleerd").into());
    }
    let v = view(&root, &root, &node);
    *TREE.lock().unwrap() = Some((root, node));
    Ok(v)
}

pub fn open(path: String) -> Result<NodeView, String> {
    let mut g = TREE.lock().unwrap();
    let (root, node) = g.as_mut().ok_or(crate::l10n::tr("Scan a drive first.", "Scan eerst een station."))?;
    let p = PathBuf::from(path);
    let root = root.clone();
    let n = find(&root, node, &p).ok_or(crate::l10n::tr("Folder not found in the map.", "Map niet gevonden."))?;
    Ok(view(&root, &p, n))
}

pub fn trash(path: String) -> Result<ActionResult, String> {
    let p = PathBuf::from(&path);
    let size = {
        let mut g = TREE.lock().unwrap();
        let (root, node) = g.as_mut().ok_or(crate::l10n::tr("Scan a drive first.", "Scan eerst een station."))?;
        let root = root.clone();
        let parent = p.parent().ok_or("Invalid path")?;
        let name = core::file_name(&p);
        find(&root, node, parent).and_then(|n| n.children.iter().find(|c| c.name == name)).map(|c| c.size).unwrap_or(0)
    };
    let mut out = core::remove(vec![RemovalRequest { path: p.clone(), size, permanent: false }], &core::is_user_trashable);
    history::record("diskmap", out.history);
    out.result.message = core::summary(&out.result);
    if out.result.removed > 0 {
        let mut g = TREE.lock().unwrap();
        if let Some((root, node)) = g.as_mut() {
            let root = root.clone();
            remove_from_tree(&root, node, &p, size);
        }
    }
    Ok(out.result)
}

fn remove_from_tree(root: &Path, node: &mut Node, p: &Path, size: u64) {
    let Ok(rel) = p.strip_prefix(root) else { return };
    let comps: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let mut cur = node;
    for (i, name) in comps.iter().enumerate() {
        cur.size = cur.size.saturating_sub(size);
        if i == comps.len() - 1 {
            cur.children.retain(|c| &c.name != name);
            return;
        }
        match cur.children.iter_mut().find(|c| c.is_dir && &c.name == name) {
            Some(n) => cur = n,
            None => return,
        }
    }
}
