//! User settings stored as JSON in %APPDATA%\WinCleaner for Gamers\settings.json.

use crate::core;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{OnceLock, RwLock};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
    /// Send cleaned caches to the Recycle Bin instead of deleting them.
    pub clean_to_recycle_bin: bool,
    pub large_min_mb: u64,
    pub old_days: u64,
    /// "Never touch" files and folders.
    pub excluded: Vec<String>,
    pub schedule_enabled: bool,
    pub schedule_days: u32,
    /// Show the Pro Tools section expanded.
    pub pro_mode: bool,
    pub close_to_tray: bool,
    /// Processes the user chose to close when boosting.
    pub boost_close: Vec<String>,
    pub prev_power_scheme: Option<String>,
    pub boost_active: bool,
    pub onboarded: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            clean_to_recycle_bin: false,
            large_min_mb: 500,
            old_days: 180,
            excluded: vec![],
            schedule_enabled: false,
            schedule_days: 7,
            pro_mode: false,
            close_to_tray: false,
            boost_close: vec![],
            prev_power_scheme: None,
            boost_active: false,
            onboarded: false,
        }
    }
}

const TASK_NAME: &str = "WinCleaner for Gamers AutoClean";

fn store() -> &'static RwLock<Prefs> {
    static S: OnceLock<RwLock<Prefs>> = OnceLock::new();
    S.get_or_init(|| {
        let p = fs::read_to_string(core::app_dir().join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
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
        let _ = fs::write(core::app_dir().join("settings.json"), s);
    }
}

/// Save settings coming from the UI, clamping values and applying the schedule.
pub fn save_from_ui(mut p: Prefs) -> Result<Prefs, String> {
    p.large_min_mb = p.large_min_mb.clamp(50, 100_000);
    p.old_days = p.old_days.clamp(30, 3650);
    p.schedule_days = p.schedule_days.clamp(1, 30);
    p.excluded.retain(|e| !e.trim().is_empty());
    let old = get();
    // Values owned by the backend aren't editable from the UI.
    p.prev_power_scheme = old.prev_power_scheme.clone();
    p.boost_active = old.boost_active;
    let schedule_changed = old.schedule_enabled != p.schedule_enabled || old.schedule_days != p.schedule_days;
    update(|cur| *cur = p.clone());
    if schedule_changed {
        apply_schedule(&p)?;
    }
    Ok(p)
}

/// Register (or remove) a Task Scheduler job that runs `--auto-clean`.
fn apply_schedule(p: &Prefs) -> Result<(), String> {
    if p.schedule_enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let tr = format!("\"{}\" --auto-clean", exe.display());
        let days = p.schedule_days.to_string();
        let (code, out) = core::run(
            "schtasks.exe",
            &["/Create", "/F", "/SC", "DAILY", "/MO", &days, "/TN", TASK_NAME, "/TR", &tr, "/ST", "12:00"],
        )?;
        if code != 0 {
            return Err(format!("Couldn't create the scheduled task: {}", out.trim()));
        }
    } else {
        let _ = core::run("schtasks.exe", &["/Delete", "/F", "/TN", TASK_NAME]);
    }
    Ok(())
}
