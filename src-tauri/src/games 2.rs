//! Game library across launchers (Steam, Epic, GOG) and leftover game folders.

use crate::core::{self, ActionResult, RemovalRequest};
use crate::history;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub launcher: String,
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub last_played: Option<u64>,
    pub drive: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameLeftover {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
    pub note: String,
    pub in_use: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub games: Vec<Game>,
    pub leftovers: Vec<GameLeftover>,
    pub launchers: Vec<String>,
}

// ---------------------------------------------------------------------------
// Valve KeyValues (.vdf / .acf)
// ---------------------------------------------------------------------------

enum Tok {
    Str(String),
    Open,
    Close,
}

fn tokenize(s: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '"' => {
                let mut v = String::new();
                while let Some(c) = it.next() {
                    match c {
                        '\\' => {
                            if let Some(n) = it.next() {
                                v.push(n);
                            }
                        }
                        '"' => break,
                        _ => v.push(c),
                    }
                }
                out.push(Tok::Str(v));
            }
            _ => {}
        }
    }
    out
}

/// All key/value string pairs, in order, ignoring nesting.
fn kv_pairs(s: &str) -> Vec<(String, String)> {
    let t = tokenize(s);
    let mut out = vec![];
    let mut i = 0;
    while i + 1 < t.len() {
        if let (Tok::Str(k), Tok::Str(v)) = (&t[i], &t[i + 1]) {
            out.push((k.to_lowercase(), v.clone()));
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn first(pairs: &[(String, String)], k: &str) -> Option<String> {
    pairs.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone())
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

pub fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(p) = hkcu.open_subkey("Software\\Valve\\Steam").and_then(|k| k.get_value::<String, _>("SteamPath")) {
            let p = PathBuf::from(p.replace('/', "\\"));
            if p.exists() {
                return Some(p);
            }
        }
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(p) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam").and_then(|k| k.get_value::<String, _>("InstallPath")) {
            let p = PathBuf::from(p);
            if p.exists() {
                return Some(p);
            }
        }
    }
    let p = PathBuf::from(r"C:\Program Files (x86)\Steam");
    p.exists().then_some(p)
}

pub fn steam_libraries() -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return vec![] };
    let mut libs = vec![root.clone()];
    if let Ok(s) = fs::read_to_string(root.join(r"steamapps\libraryfolders.vdf")) {
        for (k, v) in kv_pairs(&s) {
            if k == "path" {
                let p = PathBuf::from(v);
                if p.join("steamapps").is_dir() && !libs.iter().any(|l| core::same_path(l, &p)) {
                    libs.push(p);
                }
            }
        }
    }
    libs
}

struct SteamApp {
    id: String,
    name: String,
    installdir: String,
    size: u64,
    last_played: Option<u64>,
}

fn steam_manifests(lib: &Path) -> Vec<SteamApp> {
    let mut out = vec![];
    let Ok(rd) = fs::read_dir(lib.join("steamapps")) else { return out };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().to_lowercase();
        if !(n.starts_with("appmanifest_") && n.ends_with(".acf")) {
            continue;
        }
        let Ok(s) = fs::read_to_string(e.path()) else { continue };
        let kv = kv_pairs(&s);
        let (Some(id), Some(dir)) = (first(&kv, "appid"), first(&kv, "installdir")) else { continue };
        out.push(SteamApp {
            name: first(&kv, "name").unwrap_or_else(|| dir.clone()),
            id,
            installdir: dir,
            size: first(&kv, "sizeondisk").and_then(|v| v.parse().ok()).unwrap_or(0),
            last_played: first(&kv, "lastplayed").and_then(|v| v.parse().ok()).filter(|v: &u64| *v > 0),
        });
    }
    out
}

const STEAM_TOOLS: [&str; 2] = ["228980", "1070560"]; // redistributables, Linux runtime

fn drive_of(p: &Path) -> String {
    p.to_string_lossy().chars().take(2).collect::<String>().to_uppercase()
}

fn steam_games() -> Vec<Game> {
    let mut out = vec![];
    for lib in steam_libraries() {
        for a in steam_manifests(&lib) {
            if STEAM_TOOLS.contains(&a.id.as_str()) || a.name.starts_with("Proton ") || a.name.starts_with("Steamworks") {
                continue;
            }
            let path = lib.join("steamapps").join("common").join(&a.installdir);
            out.push(Game {
                launcher: "steam".into(),
                drive: drive_of(&path),
                id: a.id,
                name: a.name,
                path: path.display().to_string(),
                size: a.size,
                last_played: a.last_played,
            });
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Epic & GOG
// ---------------------------------------------------------------------------

fn epic_manifests() -> Vec<serde_json::Value> {
    let dir = core::program_data().join(r"Epic\EpicGamesLauncher\Data\Manifests");
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("item")))
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect()
}

fn epic_games() -> Vec<Game> {
    epic_manifests()
        .into_iter()
        .filter_map(|v| {
            let id = v.get("AppName")?.as_str()?.to_string();
            let path = v.get("InstallLocation")?.as_str()?.to_string();
            let is_game = v
                .get("AppCategories")
                .and_then(|c| c.as_array())
                .map(|c| c.iter().any(|x| x.as_str() == Some("games")))
                .unwrap_or(true);
            if !is_game {
                return None;
            }
            Some(Game {
                launcher: "epic".into(),
                name: v.get("DisplayName").and_then(|x| x.as_str()).unwrap_or(&id).to_string(),
                drive: drive_of(Path::new(&path)),
                size: v.get("InstallSize").and_then(|x| x.as_u64()).unwrap_or(0),
                id,
                path,
                last_played: None,
            })
        })
        .collect()
}

fn gog_games() -> Vec<Game> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let Ok(games) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") else { return vec![] };
        let raw: Vec<(String, String, String)> = games
            .enum_keys()
            .flatten()
            .filter_map(|k| {
                let g = games.open_subkey(&k).ok()?;
                let name: String = g.get_value("gameName").ok()?;
                let path: String = g.get_value("path").ok()?;
                let id: String = g.get_value("gameID").unwrap_or(k);
                Some((id, name, path))
            })
            .collect();
        return raw
            .into_par_iter()
            .filter(|(_, _, p)| Path::new(p).is_dir())
            .map(|(id, name, path)| Game {
                launcher: "gog".into(),
                size: core::measure(Path::new(&path), None).size,
                drive: drive_of(Path::new(&path)),
                id,
                name,
                path,
                last_played: None,
            })
            .collect();
    }
    #[cfg(not(windows))]
    vec![]
}

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------

const KEEP_COMMON: [&str; 2] = ["steamworks shared", "steam controller configs"];

pub fn find_leftovers() -> Vec<GameLeftover> {
    let steam_running = core::running_processes().contains("steam.exe");
    let mut cands: Vec<(PathBuf, &str, String, bool)> = vec![];
    for lib in steam_libraries() {
        let apps = steam_manifests(&lib);
        let dirs: HashSet<String> = apps.iter().map(|a| a.installdir.to_lowercase()).collect();
        let ids: HashSet<String> = apps.iter().map(|a| a.id.clone()).collect();
        let sa = lib.join("steamapps");
        for (sub, kind, note) in [
            ("common", "game", "Folder from an uninstalled game. May contain mods or old saves."),
            ("downloading", "download", "Unfinished or cancelled download."),
            ("temp", "temp", "Temporary download data."),
        ] {
            let Ok(rd) = fs::read_dir(sa.join(sub)) else { continue };
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let lname = name.to_lowercase();
                let orphan = match sub {
                    "common" => e.path().is_dir() && !dirs.contains(&lname) && !KEEP_COMMON.contains(&lname.as_str()),
                    "downloading" => !ids.contains(&name) && !lname.ends_with(".patch"),
                    _ => true,
                };
                if orphan {
                    cands.push((e.path(), kind, note.to_string(), sub != "common" && steam_running));
                }
            }
        }
    }
    cands
        .into_par_iter()
        .map(|(p, kind, note, in_use)| GameLeftover {
            name: core::file_name(&p),
            size: core::measure(&p, None).size,
            path: p.display().to_string(),
            kind: kind.into(),
            note,
            in_use,
        })
        .filter(|l| l.size > 0 || l.kind == "game")
        .collect()
}

pub fn library() -> Library {
    let (mut games, (epic, gog)) = rayon::join(steam_games, || rayon::join(epic_games, gog_games));
    let mut launchers = vec![];
    if steam_root().is_some() {
        launchers.push("steam".to_string());
    }
    if !epic.is_empty() {
        launchers.push("epic".into());
    }
    if !gog.is_empty() {
        launchers.push("gog".into());
    }
    games.extend(epic);
    games.extend(gog);
    games.sort_by(|a, b| b.size.cmp(&a.size));
    Library { games, leftovers: find_leftovers(), launchers }
}

pub fn trash_leftovers(paths: Vec<String>) -> ActionResult {
    let valid: Vec<GameLeftover> = find_leftovers();
    let reqs: Vec<RemovalRequest> = paths
        .iter()
        .filter_map(|p| valid.iter().find(|l| l.path == *p && !l.in_use))
        .map(|l| RemovalRequest { path: PathBuf::from(&l.path), size: l.size, permanent: false })
        .collect();
    let allowed: HashSet<String> = reqs.iter().map(|r| r.path.display().to_string()).collect();
    let out = core::remove(reqs, &|p| allowed.contains(&p.display().to_string()));
    history::record("Game leftovers", out.history);
    out.result
}

// ---------------------------------------------------------------------------
// Launcher actions
// ---------------------------------------------------------------------------

/// Build a launcher URL from a known game. Never opens arbitrary URLs.
pub fn action_url(launcher: &str, id: &str, action: &str) -> Result<String, String> {
    match launcher {
        "steam" => {
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return Err("Invalid Steam app id.".into());
            }
            Ok(match action {
                "play" => format!("steam://rungameid/{id}"),
                "uninstall" => format!("steam://uninstall/{id}"),
                "verify" => format!("steam://validate/{id}"),
                _ => return Err("Unknown action.".into()),
            })
        }
        "epic" => {
            let m = epic_manifests()
                .into_iter()
                .find(|v| v.get("AppName").and_then(|x| x.as_str()) == Some(id))
                .ok_or("Game not found.")?;
            let s = |k: &str| m.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let triple = format!("{}%3A{}%3A{}", s("CatalogNamespace"), s("CatalogItemId"), s("AppName"));
            if !triple.chars().all(|c| c.is_ascii_alphanumeric() || c == '%' || c == '-' || c == '_') {
                return Err("Unexpected Epic manifest data.".into());
            }
            Ok(match action {
                "play" => format!("com.epicgames.launcher://apps/{triple}?action=launch&silent=true"),
                "verify" => format!("com.epicgames.launcher://apps/{triple}?action=verify"),
                "uninstall" => "com.epicgames.launcher://store/library".into(),
                _ => return Err("Unknown action.".into()),
            })
        }
        "gog" => {
            if !id.chars().all(|c| c.is_ascii_digit()) {
                return Err("Invalid GOG id.".into());
            }
            Ok(format!("goggalaxy://openGameView/{id}"))
        }
        _ => Err("Unknown launcher.".into()),
    }
}
