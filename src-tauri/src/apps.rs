//! Installed programs (from the registry), uninstalling them, and their leftovers.

use crate::core::{self, ActionResult, RemovalRequest};
use crate::history;
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
                let q = s("QuietUninstallString");
                let u = s("UninstallString");
                if u.is_empty() { q } else { u }
            };
            if name.trim().is_empty() || uninstall.is_empty() || d("SystemComponent") == 1 || !s("ParentKeyName").is_empty() {
                continue;
            }
            let rt = s("ReleaseType").to_lowercase();
            if rt.contains("update") || rt.contains("hotfix") {
                continue;
            }
            let location = s("InstallLocation").trim_matches('"').to_string();
            let lower = format!("{} {}", location.to_lowercase(), s("Publisher").to_lowercase());
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
    // Fill in missing sizes from the install folder.
    apps.par_iter_mut().filter(|a| a.size == 0 && !a.location.is_empty()).for_each(|a| {
        let p = Path::new(&a.location);
        if p.is_dir() && p.components().count() > 2 {
            a.size = core::measure(p, None).size;
        }
    });
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
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
    let raw = read_registry().into_iter().find(|r| r.app.id == id).ok_or("That program is no longer installed.")?;
    let (exe, mut args) = split_command(&raw.uninstall);
    let exe_name = core::file_name(Path::new(&exe)).to_lowercase();
    let exe = if exe_name == "msiexec.exe" || exe_name == "msiexec" {
        // Force interactive uninstall rather than "change/repair".
        args = args.replace("/I{", "/X{").replace("/i{", "/X{");
        "msiexec.exe".to_string()
    } else {
        exe
    };
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
    let leftovers = find_leftovers(&raw.app);
    Ok(UninstallResult {
        message: if still {
            format!("{} still looks installed. If its uninstaller is still open, finish it first.", raw.app.name)
        } else {
            format!("{} uninstalled", raw.app.name)
        },
        still_installed: still,
        leftovers,
    })
}

fn leftover_roots() -> Vec<(PathBuf, bool)> {
    let mut v = vec![
        (core::roaming(), true),
        (core::local(), false),
        (core::local_low(), true),
        (core::program_data(), false),
    ];
    v.extend(core::program_files().into_iter().map(|p| (p, false)));
    v
}

const SHARED_NAMES: [&str; 22] = [
    "microsoft", "windows", "common files", "packages", "temp", "programs", "intel", "nvidia", "nvidia corporation",
    "amd", "google", "mozilla", "apple", "adobe", "steam", "epic games", "valve", "unity", "unreal engine", "crashdumps",
    "windowsapps", "package cache",
];

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Name variants used to match leftover folders, e.g. "Discord", "discord".
fn name_keys(app: &InstalledApp) -> Vec<String> {
    let mut keys = vec![norm(&app.name)];
    // "Foo Bar 2.3.1" / "Foo Bar (x64)" -> "Foo Bar"
    let trimmed: String = app
        .name
        .split(|c: char| c == '(' || c == '-')
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
    let keys = name_keys(app);
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
            } else if publisher.len() >= 4 && n == publisher && !SHARED_NAMES.iter().any(|s| norm(s) == n) {
                // Publisher\Product layout.
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
    hits.into_par_iter()
        .filter(|(p, _)| !core::is_excluded(p))
        .map(|(p, personal)| Leftover { size: core::measure(&p, None).size, path: p.display().to_string(), personal })
        .collect()
}

/// Leftovers must sit one or two levels inside a known app-data / program folder.
pub fn is_leftover_path(p: &Path) -> bool {
    leftover_roots().iter().any(|(root, _)| {
        core::direct_child(p, root) && !SHARED_NAMES.iter().any(|s| norm(s) == norm(&core::file_name(p)))
            || p.parent().is_some_and(|parent| core::direct_child(parent, root) && !SHARED_NAMES.iter().any(|s| norm(s) == norm(&core::file_name(parent))))
    })
}

pub fn trash_leftovers(paths: Vec<String>) -> ActionResult {
    let reqs = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .map(|p| RemovalRequest { size: core::measure(&p, None).size, path: p, permanent: false })
        .collect();
    let mut out = core::remove(reqs, &is_leftover_path);
    history::record("Uninstall leftovers", out.history);
    out.result.message = crate::clean::summary(&out.result);
    out.result
}
