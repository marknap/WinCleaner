//! Log of everything removed, with "Put back" for items sent to the Recycle Bin.

use crate::core;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub path: String,
    pub size: u64,
    pub recycled: bool,
    #[serde(default)]
    pub restored: bool,
}

impl HistoryItem {
    pub fn new(p: &Path, size: u64, recycled: bool) -> Self {
        HistoryItem { path: p.display().to_string(), size, recycled, restored: false }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub date: u64,
    pub tool: String,
    pub freed: u64,
    pub items: Vec<HistoryItem>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct HistoryFile {
    pub entries: Vec<HistoryEntry>,
    pub lifetime_freed: u64,
    pub lifetime_items: u64,
    pub boosts: u64,
    pub scans: u64,
}

const MAX_ENTRIES: usize = 200;
static LOCK: Mutex<()> = Mutex::new(());

fn file() -> PathBuf {
    core::app_dir().join("history.json")
}

pub fn load() -> HistoryFile {
    fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(h: &HistoryFile) {
    if let Ok(s) = serde_json::to_string(h) {
        let _ = fs::write(file(), s);
    }
}

fn modify<T>(f: impl FnOnce(&mut HistoryFile) -> T) -> T {
    let _g = LOCK.lock().unwrap();
    let mut h = load();
    let r = f(&mut h);
    save(&h);
    r
}

pub fn record(tool: &str, items: Vec<HistoryItem>) {
    if items.is_empty() {
        return;
    }
    let freed: u64 = items.iter().map(|i| i.size).sum();
    modify(|h| {
        h.lifetime_freed += freed;
        h.lifetime_items += items.len() as u64;
        let date = core::now_secs();
        h.entries.insert(0, HistoryEntry { id: format!("{date}-{}", h.entries.len()), date, tool: tool.into(), freed, items });
        h.entries.truncate(MAX_ENTRIES);
    });
}

pub fn add_boost() {
    modify(|h| h.boosts += 1);
}
pub fn add_scan() {
    modify(|h| h.scans += 1);
}
pub fn clear() {
    modify(|h| h.entries.clear());
}

/// Restore one item from the Recycle Bin to its original location.
pub fn put_back(entry_id: &str, index: usize) -> Result<String, String> {
    let original = {
        let h = load();
        let e = h.entries.iter().find(|e| e.id == entry_id).ok_or("History entry not found.")?;
        let it = e.items.get(index).ok_or("Item not found.")?;
        if !it.recycled || it.restored {
            return Err("This item can't be put back.".into());
        }
        PathBuf::from(&it.path)
    };
    if original.exists() {
        return Err("Something already exists at the original location.".into());
    }
    #[cfg(windows)]
    {
        let items = trash::os_limited::list().map_err(|e| e.to_string())?;
        let found = items
            .into_iter()
            .filter(|t| core::same_path(&t.original_parent.join(&t.name), &original))
            .max_by_key(|t| t.time_deleted)
            .ok_or("It's no longer in the Recycle Bin.")?;
        trash::os_limited::restore_all([found]).map_err(|e| format!("Couldn't restore: {e:?}"))?;
    }
    modify(|h| {
        if let Some(it) = h.entries.iter_mut().find(|e| e.id == entry_id).and_then(|e| e.items.get_mut(index)) {
            it.restored = true;
        }
    });
    Ok(format!("Restored {}", core::file_name(&original)))
}
