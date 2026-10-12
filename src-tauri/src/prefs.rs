//! User settings stored as JSON in %APPDATA%\WinCleaner for Gamers\settings.json.

use crate::{core, diag, l10n, trf};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{OnceLock, RwLock};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RecentUninstall {
    pub name: String,
    pub publisher: String,
    pub location: String,
    pub date: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    /// "auto", "en" or "nl".
    pub language: String,
    /// Send cleaned caches to the Recycle Bin instead of deleting them.
    pub clean_to_recycle_bin: bool,
    /// The user has seen the "caches are deleted for good" explanation.
    pub confirmed_permanent: bool,
    pub large_min_mb: u64,
    pub old_days: u64,
    /// "Never touch" files and folders.
    pub excluded: Vec<String>,
    pub schedule_enabled: bool,
    pub schedule_days: u32,
    pub pro_mode: bool,
    pub close_to_tray: bool,
    /// Create a System Restore point before boosting or changing settings.
    pub restore_points: bool,
    pub boost_close: Vec<String>,
    pub pinned_cards: Vec<String>,
    pub achievements_seen: Vec<String>,
    pub presentmon_path: Option<String>,
    pub onboarded: bool,
    // Owned by the backend:
    pub prev_power_scheme: Option<String>,
    pub boost_scheme: Option<String>,
    pub boost_active: bool,
    pub last_restore_point: u64,
    pub recent_uninstalls: Vec<RecentUninstall>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            language: "auto".into(),
            clean_to_recycle_bin: false,
            confirmed_permanent: false,
            large_min_mb: 500,
            old_days: 180,
            excluded: vec![],
            schedule_enabled: false,
            schedule_days: 7,
            pro_mode: false,
            close_to_tray: false,
            restore_points: true,
            boost_close: vec![],
            pinned_cards: vec![],
            achievements_seen: vec![],
            presentmon_path: None,
            onboarded: false,
            prev_power_scheme: None,
            boost_scheme: None,
            boost_active: false,
            last_restore_point: 0,
            recent_uninstalls: vec![],
        }
    }
}

const TASK_NAME: &str = "WinCleaner for Gamers AutoClean";

fn file() -> std::path::PathBuf {
    core::app_dir().join("settings.json")
}

fn store() -> &'static RwLock<Prefs> {
    static S: OnceLock<RwLock<Prefs>> = OnceLock::new();
    S.get_or_init(|| {
        let p = fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        RwLock::new(p)
    })
}

pub fn get() -> Prefs {
    store().read().unwrap().clone()
}

pub fn update(f: impl FnOnce(&mut Prefs)) {
    let mut g = store().write().unwrap();
    f(&mut g);
    if let Ok(s) = serde_json::to_string_pretty(&*g) {
        let _ = fs::write(file(), s);
    }
}

fn valid_presentmon(p: &str) -> bool {
    let path = Path::new(p);
    let name = core::file_name(path).to_lowercase();
    name.starts_with("presentmon") && name.ends_with(".exe") && path.is_file()
}

/// Save settings coming from the UI, clamping values and applying side effects.
pub fn save_from_ui(mut p: Prefs) -> Result<Prefs, String> {
    p.large_min_mb = p.large_min_mb.clamp(50, 100_000);
    p.old_days = p.old_days.clamp(30, 3650);
    p.schedule_days = p.schedule_days.clamp(1, 30);
    p.excluded.retain(|e| !e.trim().is_empty());
    if !["auto", "en", "nl"].contains(&p.language.as_str()) {
        p.language = "auto".into();
    }
    if p.presentmon_path.as_deref().is_some_and(|x| !valid_presentmon(x)) {
        return Err(l10n::tr("That doesn't look like PresentMon.exe.", "Dat lijkt niet op PresentMon.exe.").into());
    }
    let old = get();
    p.prev_power_scheme = old.prev_power_scheme.clone();
    p.boost_scheme = old.boost_scheme.clone();
    p.boost_active = old.boost_active;
    p.last_restore_point = old.last_restore_point;
    p.recent_uninstalls = old.recent_uninstalls.clone();
    let schedule_changed = old.schedule_enabled != p.schedule_enabled || old.schedule_days != p.schedule_days;
    update(|cur| *cur = p.clone());
    l10n::set(&p.language);
    if schedule_changed {
        apply_schedule(&p)?;
    }
    Ok(p)
}

pub fn export(path: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".json") {
        return Err(l10n::tr("Choose a .json file.", "Kies een .json-bestand.").into());
    }
    let p = get();
    // Only user choices; machine-specific state stays behind.
    let v = serde_json::json!({
        "app": "WinCleaner for Gamers",
        "language": p.language,
        "cleanToRecycleBin": p.clean_to_recycle_bin,
        "largeMinMb": p.large_min_mb,
        "oldDays": p.old_days,
        "excluded": p.excluded,
        "scheduleEnabled": p.schedule_enabled,
        "scheduleDays": p.schedule_days,
        "proMode": p.pro_mode,
        "closeToTray": p.close_to_tray,
        "restorePoints": p.restore_points,
        "boostClose": p.boost_close,
        "pinnedCards": p.pinned_cards,
    });
    fs::write(&path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| e.to_string())
}

pub fn import(path: String) -> Result<Prefs, String> {
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&s).map_err(|_| l10n::tr("Not a valid settings file.", "Geen geldig instellingenbestand."))?;
    if v.get("app").and_then(|a| a.as_str()) != Some("WinCleaner for Gamers") {
        return Err(l10n::tr("Not a WinCleaner settings file.", "Geen WinCleaner-instellingenbestand.").into());
    }
    // Merge onto current settings so unknown or missing keys keep their value.
    let mut cur = serde_json::to_value(get()).map_err(|e| e.to_string())?;
    if let (Some(dst), Some(src)) = (cur.as_object_mut(), v.as_object()) {
        for (k, val) in src {
            if k != "app" && dst.contains_key(k) {
                dst.insert(k.clone(), val.clone());
            }
        }
    }
    let p: Prefs = serde_json::from_value(cur).map_err(|e| e.to_string())?;
    diag::info(format!("Imported settings from {path}"));
    save_from_ui(p)
}

pub fn add_recent_uninstall(r: RecentUninstall) {
    update(|p| {
        p.recent_uninstalls.retain(|x| x.name != r.name);
        p.recent_uninstalls.insert(0, r);
        p.recent_uninstalls.truncate(20);
    });
}

/// Register (or remove) a Task Scheduler job that runs `--auto-clean`.
fn apply_schedule(p: &Prefs) -> Result<(), String> {
    let schtasks = core::windir().join(r"System32\schtasks.exe").display().to_string();
    if p.schedule_enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let tr = format!("\"{}\" --auto-clean", exe.display());
        let days = p.schedule_days.to_string();
        let (code, out) = core::run(&schtasks, &["/Create", "/F", "/SC", "DAILY", "/MO", &days, "/TN", TASK_NAME, "/TR", &tr, "/ST", "12:00"])?;
        if code != 0 {
            diag::warn(format!("schtasks create failed: {}", out.trim()));
            return Err(trf!("Couldn't create the scheduled task: {}", "Kon de geplande taak niet maken: {}", out.trim()));
        }
        diag::info(format!("Scheduled auto-clean every {days} days"));
    } else {
        let _ = core::run(&schtasks, &["/Delete", "/F", "/TN", TASK_NAME]);
        diag::info("Removed scheduled auto-clean");
    }
    Ok(())
}
