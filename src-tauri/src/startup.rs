//! Startup apps: registry Run keys and Startup folders, toggled the same way
//! Task Manager does it (StartupApproved), so changes are fully reversible.

use crate::core;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub location: String,
    pub enabled: bool,
    pub needs_admin: bool,
    pub advice: String,
    pub advice_text: String,
}

struct Source {
    id: &'static str,
    machine: bool,
    run_key: Option<&'static str>,
    folder: Option<PathBuf>,
    approved: &'static str,
    label: &'static str,
}

const APPROVED: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\";

fn sources() -> Vec<Source> {
    vec![
        Source { id: "hkcu", machine: false, run_key: Some("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), folder: None, approved: "Run", label: "You" },
        Source { id: "hklm", machine: true, run_key: Some("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"), folder: None, approved: "Run", label: "All users" },
        Source { id: "hklm32", machine: true, run_key: Some("SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run"), folder: None, approved: "Run32", label: "All users" },
        Source { id: "userfolder", machine: false, run_key: None, folder: Some(core::roaming().join(r"Microsoft\Windows\Start Menu\Programs\Startup")), approved: "StartupFolder", label: "You" },
        Source { id: "commonfolder", machine: true, run_key: None, folder: Some(core::program_data().join(r"Microsoft\Windows\Start Menu\Programs\StartUp")), approved: "StartupFolder", label: "All users" },
    ]
}

/// (match, friendly name, advice, explanation)
const KNOWN: &[(&str, &str, &str, &str)] = &[
    ("securityhealth", "Windows Security", "keep", "Protects your PC. Keep it on."),
    ("steam", "Steam", "disable", "Opens by itself when you launch a game."),
    ("epicgames", "Epic Games Launcher", "disable", "Open it when you want to play."),
    ("battle.net", "Battle.net", "disable", "Open it when you want to play."),
    ("eadesktop", "EA app", "disable", "Open it when you want to play."),
    ("eabackgroundservice", "EA app", "disable", "Open it when you want to play."),
    ("upc.exe", "Ubisoft Connect", "disable", "Open it when you want to play."),
    ("ubisoft", "Ubisoft Connect", "disable", "Open it when you want to play."),
    ("galaxyclient", "GOG Galaxy", "disable", "Open it when you want to play."),
    ("riotclient", "Riot Client", "optional", "Vanguard anti-cheat may want this for Valorant."),
    ("discord", "Discord", "optional", "Disable if you only use Discord while gaming."),
    ("spotify", "Spotify", "disable", "Opens fast enough when you need it."),
    ("onedrive", "OneDrive", "optional", "Keeps files synced. Disable if you don't use OneDrive."),
    ("teams", "Microsoft Teams", "disable", "Uses RAM in the background."),
    ("skype", "Skype", "disable", "Uses RAM in the background."),
    ("slack", "Slack", "disable", "Uses RAM in the background."),
    ("zoom", "Zoom", "disable", "Uses RAM in the background."),
    ("dropbox", "Dropbox", "optional", "Keeps files synced."),
    ("googledrive", "Google Drive", "optional", "Keeps files synced."),
    ("adobe", "Adobe helper", "disable", "Updaters and sync helpers you rarely need."),
    ("creative cloud", "Adobe Creative Cloud", "disable", "Uses RAM in the background."),
    ("ccleaner", "CCleaner", "disable", "Not needed at startup."),
    ("utorrent", "uTorrent", "disable", "Not needed at startup."),
    ("nvidia", "NVIDIA", "keep", "Graphics driver helper. Keep it on."),
    ("nvcontainer", "NVIDIA", "keep", "Graphics driver helper. Keep it on."),
    ("radeon", "AMD Software", "keep", "Graphics driver helper. Keep it on."),
    ("amd", "AMD Software", "keep", "Driver helper. Keep it on."),
    ("realtek", "Realtek Audio", "keep", "Audio driver. Keep it on."),
    ("rtkaud", "Realtek Audio", "keep", "Audio driver. Keep it on."),
    ("razer", "Razer Synapse", "keep", "Keep it if you use RGB lighting or macros."),
    ("lghub", "Logitech G HUB", "keep", "Keep it if you use RGB lighting, DPI or macros."),
    ("icue", "Corsair iCUE", "keep", "Keep it if you use RGB lighting or fan control."),
    ("steelseries", "SteelSeries GG", "keep", "Keep it if you use device settings or RGB."),
    ("msiafterburner", "MSI Afterburner", "keep", "Keep it if you use fan curves or an overclock."),
    ("rtss", "RivaTuner Statistics Server", "keep", "Keep it for FPS overlays and frame limiting."),
    ("wallpaper", "Wallpaper Engine", "optional", "Pauses during games, but still uses some RAM."),
    ("obs", "OBS Studio", "disable", "Open it when you stream or record."),
    ("medal", "Medal", "optional", "Keep it if you clip with Medal."),
    ("overwolf", "Overwolf", "disable", "Uses RAM and can cost FPS."),
    ("msedge", "Microsoft Edge", "disable", "Startup boost keeps Edge in RAM."),
    ("googleupdate", "Google Updater", "optional", "Keeps Chrome up to date."),
];

fn advise(name: &str, command: &str) -> (String, String, String) {
    let hay = format!("{} {}", name.to_lowercase(), command.to_lowercase());
    for (k, friendly, a, t) in KNOWN {
        if hay.contains(k) {
            return (friendly.to_string(), a.to_string(), t.to_string());
        }
    }
    (name.to_string(), "unknown".into(), String::new())
}

#[cfg(windows)]
mod imp {
    use super::*;
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    fn hive(machine: bool) -> RegKey {
        RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
    }

    fn approved_enabled(src: &Source, name: &str) -> bool {
        hive(src.machine)
            .open_subkey(format!("{APPROVED}{}", src.approved))
            .and_then(|k| k.get_raw_value(name))
            .map(|v| v.bytes.first().map(|b| b & 1 == 0).unwrap_or(true))
            .unwrap_or(true)
    }

    pub fn list() -> Vec<StartupItem> {
        let mut out = vec![];
        for src in sources() {
            let mut entries: Vec<(String, String)> = vec![];
            if let Some(rk) = src.run_key {
                if let Ok(k) = hive(src.machine).open_subkey(rk) {
                    for (name, _) in k.enum_values().flatten() {
                        let cmd: String = k.get_value(&name).unwrap_or_default();
                        entries.push((name, cmd));
                    }
                }
            }
            if let Some(dir) = &src.folder {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for e in rd.flatten() {
                        let n = e.file_name().to_string_lossy().to_string();
                        if n.eq_ignore_ascii_case("desktop.ini") {
                            continue;
                        }
                        entries.push((n, e.path().display().to_string()));
                    }
                }
            }
            for (name, command) in entries {
                if name.is_empty() {
                    continue;
                }
                let (friendly, advice, text) = advise(&name, &command);
                out.push(StartupItem {
                    id: format!("{}|{}", src.id, name),
                    enabled: approved_enabled(&src, &name),
                    name: friendly,
                    command,
                    location: src.label.into(),
                    needs_admin: src.machine,
                    advice,
                    advice_text: text,
                });
            }
        }
        out.sort_by(|a, b| b.enabled.cmp(&a.enabled).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        out
    }

    pub fn set_enabled(id: &str, enabled: bool) -> Result<(), String> {
        let (sid, name) = id.split_once('|').ok_or("Bad id")?;
        let src = sources().into_iter().find(|s| s.id == sid).ok_or("Unknown source")?;
        // Only toggle entries that really exist.
        if !list().iter().any(|i| i.id == id) {
            return Err("That startup item no longer exists.".into());
        }
        if src.machine && !core::is_admin() {
            return Err("This one is set for all users. Restart WinCleaner as admin to change it.".into());
        }
        let (key, _) = hive(src.machine)
            .create_subkey(format!("{APPROVED}{}", src.approved))
            .map_err(|e| format!("Couldn't open the startup settings: {e}"))?;
        let mut bytes = vec![0u8; 12];
        if enabled {
            bytes[0] = 0x02;
        } else {
            bytes[0] = 0x03;
            let ft = (core::now_secs() + 11_644_473_600) * 10_000_000; // FILETIME
            bytes[4..12].copy_from_slice(&ft.to_le_bytes());
        }
        key.set_raw_value(name, &RegValue { vtype: REG_BINARY, bytes: bytes.into() })
            .map_err(|e| format!("Couldn't change it: {e}"))
    }
}

#[cfg(windows)]
pub use imp::{list, set_enabled};

#[cfg(not(windows))]
pub fn list() -> Vec<StartupItem> {
    vec![]
}
#[cfg(not(windows))]
pub fn set_enabled(_id: &str, _enabled: bool) -> Result<(), String> {
    Err("Windows only".into())
}
