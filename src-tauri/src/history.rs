//! Log of everything removed, with "Put back", plus counters for ranks and achievements.

use crate::{core, diag, l10n, trf};
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
    /// .reg backup for removed registry keys.
    #[serde(default)]
    pub backup: Option<String>,
}

impl HistoryItem {
    pub fn new(p: &Path, size: u64, recycled: bool) -> Self {
        HistoryItem { path: p.display().to_string(), size, recycled, restored: false, backup: None }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub date: u64,
    /// Tool id, e.g. "clean", "duplicates". Older versions stored an English label.
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
    pub startup_disabled: u64,
    pub tweaks: u64,
    pub benchmarks: u64,
    /// Days (since 1970) with any activity, newest first. Used for streaks.
    pub active_days: Vec<u64>,
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
    let today = core::now_secs() / 86400;
    if h.active_days.first() != Some(&today) {
        h.active_days.insert(0, today);
        h.active_days.truncate(400);
    }
    save(&h);
    r
}

pub fn record(tool: &str, items: Vec<HistoryItem>) {
    if items.is_empty() {
        return;
    }
    let freed: u64 = items.iter().map(|i| i.size).sum();
    diag::info(format!("{tool}: removed {} items, {}", items.len(), core::format_bytes(freed)));
    modify(|h| {
        h.lifetime_freed += freed;
        h.lifetime_items += items.len() as u64;
        let date = core::now_secs();
        h.entries.insert(0, HistoryEntry { id: format!("{date}-{}", h.entries.len()), date, tool: tool.into(), freed, items });
        h.entries.truncate(MAX_ENTRIES);
    });
}

pub enum Counter {
    Boost,
    Scan,
    StartupDisabled,
    Tweak,
    Benchmark,
}

pub fn bump(c: Counter) {
    modify(|h| match c {
        Counter::Boost => h.boosts += 1,
        Counter::Scan => h.scans += 1,
        Counter::StartupDisabled => h.startup_disabled += 1,
        Counter::Tweak => h.tweaks += 1,
        Counter::Benchmark => h.benchmarks += 1,
    });
}

pub fn clear() {
    modify(|h| h.entries.clear());
}

/// Restore one item: from the Recycle Bin, or re-import a registry backup.
pub fn put_back(entry_id: &str, index: usize) -> Result<String, String> {
    let item = {
        let h = load();
        let e = h.entries.iter().find(|e| e.id == entry_id).ok_or(l10n::tr("History entry not found.", "Geschiedenis-item niet gevonden."))?;
        e.items.get(index).cloned().ok_or(l10n::tr("Item not found.", "Item niet gevonden."))?
    };
    if item.restored || (!item.recycled && item.backup.is_none()) {
        return Err(l10n::tr("This item can't be put back.", "Dit item kan niet worden teruggezet.").into());
    }
    if let Some(backup) = &item.backup {
        restore_registry(backup)?;
    } else {
        restore_recycled(&PathBuf::from(&item.path))?;
    }
    modify(|h| {
        if let Some(it) = h.entries.iter_mut().find(|e| e.id == entry_id).and_then(|e| e.items.get_mut(index)) {
            it.restored = true;
        }
    });
    diag::info(format!("Put back {}", item.path));
    Ok(trf!("Restored {}", "{} teruggezet", core::file_name(Path::new(&item.path))))
}

fn restore_registry(backup: &str) -> Result<(), String> {
    let b = PathBuf::from(backup);
    if !core::strictly_inside(&b, &core::app_dir().join("registry-backups")) || !b.is_file() {
        return Err(l10n::tr("The registry backup is missing.", "De registerback-up ontbreekt.").into());
    }
    let reg = core::windir().join(r"System32\reg.exe").display().to_string();
    match core::run(&reg, &["import", backup])? {
        (0, _) => Ok(()),
        (_, out) => Err(out.trim().to_string()),
    }
}

#[cfg(windows)]
fn restore_recycled(original: &Path) -> Result<(), String> {
    if original.exists() {
        return Err(l10n::tr("Something already exists at the original location.", "Er staat al iets op de oorspronkelijke locatie.").into());
    }
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    let found = items
        .into_iter()
        .filter(|t| core::same_path(&t.original_parent.join(&t.name), original))
        .max_by_key(|t| t.time_deleted)
        .ok_or(l10n::tr("It's no longer in the Recycle Bin.", "Het staat niet meer in de Prullenbak."))?;
    trash::os_limited::restore_all([found]).map_err(|e| format!("{e:?}"))
}
#[cfg(not(windows))]
fn restore_recycled(_original: &Path) -> Result<(), String> {
    Err("Windows only".into())
}
