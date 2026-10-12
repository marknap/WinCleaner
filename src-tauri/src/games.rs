//! Game library across launchers (Steam, Epic, GOG, Battle.net) and leftover game folders.

use crate::core::{self, ActionResult, RemovalRequest};
use crate::l10n::tr;
use crate::{apps, history};
use base64::Engine;
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
    /// Registry uninstall id, for games removed through the Uninstaller (Battle.net).
    pub uninstall_id: Option<String>,
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
        for p in library_paths(&s) {
            if p.join("steamapps").is_dir() && !libs.iter().any(|l| core::same_path(l, &p)) {
                libs.push(p);
            }
        }
    }
    libs
}

fn library_paths(vdf: &str) -> Vec<PathBuf> {
    kv_pairs(vdf).into_iter().filter(|(k, _)| k == "path").map(|(_, v)| PathBuf::from(v)).collect()
}

struct SteamApp {
    id: String,
    name: String,
    installdir: String,
    size: u64,
    last_played: Option<u64>,
}

fn parse_manifest(s: &str) -> Option<SteamApp> {
    let kv = kv_pairs(s);
    let id = first(&kv, "appid")?;
    let dir = first(&kv, "installdir")?;
    Some(SteamApp {
        name: first(&kv, "name").unwrap_or_else(|| dir.clone()),
        id,
        installdir: dir,
        size: first(&kv, "sizeondisk").and_then(|v| v.parse().ok()).unwrap_or(0),
        last_played: first(&kv, "lastplayed").and_then(|v| v.parse().ok()).filter(|v: &u64| *v > 0),
    })
}

fn steam_manifests(lib: &Path) -> Vec<SteamApp> {
    let Ok(rd) = fs::read_dir(lib.join("steamapps")) else { return vec![] };
    rd.flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.starts_with("appmanifest_") && n.ends_with(".acf")
        })
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .filter_map(|s| parse_manifest(&s))
        .collect()
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
                uninstall_id: None,
            });
        }
    }
    out
}

/// Cover art from Steam's local library cache, as a data URL (no network needed).
pub fn steam_art(appid: &str) -> Option<String> {
    if appid.is_empty() || !appid.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let cache = steam_root()?.join(r"appcache\librarycache");
    let mut candidates = vec![cache.join(format!("{appid}_header.jpg")), cache.join(appid).join("header.jpg")];
    // Newer Steam versions nest art one level deeper in a hashed folder.
    if let Ok(rd) = fs::read_dir(cache.join(appid)) {
        for e in rd.flatten().filter(|e| e.path().is_dir()) {
            candidates.push(e.path().join("header.jpg"));
        }
    }
    candidates.push(cache.join(appid).join("library_header.jpg"));
    let file = candidates.into_iter().find(|p| p.is_file() && fs::metadata(p).map(|m| m.len() < 2_000_000).unwrap_or(false))?;
    let bytes = fs::read(file).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ---------------------------------------------------------------------------
// Epic, GOG, Battle.net
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
            let is_game = v.get("AppCategories").and_then(|c| c.as_array()).map(|c| c.iter().any(|x| x.as_str() == Some("games"))).unwrap_or(true);
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
                uninstall_id: None,
            })
        })
        .collect()
}

#[cfg(windows)]
fn gog_games() -> Vec<Game> {
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
        raw.into_par_iter()
            .filter(|(_, _, p)| Path::new(p).is_dir())
            .map(|(id, name, path)| Game {
                launcher: "gog".into(),
                size: core::measure(Path::new(&path), None).size,
                drive: drive_of(Path::new(&path)),
                id,
                name,
                path,
                last_played: None,
                uninstall_id: None,
            })
            .collect()
    }
}
#[cfg(not(windows))]
fn gog_games() -> Vec<Game> {
    vec![]
}

/// Battle.net registers each game as a normal Windows program whose uninstaller
/// is "Battle.net Launcher.exe".
fn battlenet_games() -> Vec<Game> {
    apps::battlenet_entries()
        .into_par_iter()
        .map(|a| {
            let size = if a.size > 0 || a.location.is_empty() { a.size } else { core::measure(Path::new(&a.location), None).size };
            Game {
                launcher: "battlenet".into(),
                drive: drive_of(Path::new(&a.location)),
                id: a.id.clone(),
                name: a.name,
                path: a.location,
                size,
                last_played: None,
                uninstall_id: Some(a.id),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------

const KEEP_COMMON: [&str; 2] = ["steamworks shared", "steam controller configs"];

pub fn find_leftovers() -> Vec<GameLeftover> {
    let steam_running = core::running_processes().contains("steam.exe");
    let mut cands: Vec<(PathBuf, &str, &str, bool)> = vec![];
    for lib in steam_libraries() {
        let apps = steam_manifests(&lib);
        let dirs: HashSet<String> = apps.iter().map(|a| a.installdir.to_lowercase()).collect();
        let ids: HashSet<String> = apps.iter().map(|a| a.id.clone()).collect();
        let sa = lib.join("steamapps");
        for (sub, kind, note) in [
            ("common", "game", tr("Folder from an uninstalled game. May contain mods or old saves.", "Map van een verwijderde game. Kan mods of oude saves bevatten.")),
            ("downloading", "download", tr("Unfinished or cancelled download.", "Onvoltooide of geannuleerde download.")),
            ("temp", "temp", tr("Temporary download data.", "Tijdelijke downloadgegevens.")),
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
                    cands.push((e.path(), kind, note, sub != "common" && steam_running));
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
            note: note.into(),
            in_use,
        })
        .filter(|l| l.size > 0 || l.kind == "game")
        .collect()
}

pub fn library() -> Library {
    let ((mut games, epic), (gog, bnet)) = rayon::join(|| rayon::join(steam_games, epic_games), || rayon::join(gog_games, battlenet_games));
    let mut launchers = vec![];
    if steam_root().is_some() {
        launchers.push("steam".to_string());
    }
    for (l, v) in [("epic", &epic), ("gog", &gog), ("battlenet", &bnet)] {
        if !v.is_empty() {
            launchers.push(l.into());
        }
    }
    games.extend(epic);
    games.extend(gog);
    games.extend(bnet);
    games.sort_by_key(|g| std::cmp::Reverse(g.size));
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
    let mut out = core::remove(reqs, &|p| allowed.contains(&p.display().to_string()));
    history::record("gameleftovers", out.history);
    out.result.message = core::summary(&out.result);
    out.result
}

// ---------------------------------------------------------------------------
// Launcher actions
// ---------------------------------------------------------------------------

/// Build a launcher URL from a known game. Never opens arbitrary URLs.
pub fn action_url(launcher: &str, id: &str, action: &str) -> Result<String, String> {
    let unknown = || tr("Unknown action.", "Onbekende actie.").to_string();
    match launcher {
        "steam" => {
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return Err(tr("Invalid Steam app id.", "Ongeldige Steam-app-id.").into());
            }
            Ok(match action {
                "play" => format!("steam://rungameid/{id}"),
                "uninstall" => format!("steam://uninstall/{id}"),
                "verify" => format!("steam://validate/{id}"),
                _ => return Err(unknown()),
            })
        }
        "epic" => {
            let m = epic_manifests()
                .into_iter()
                .find(|v| v.get("AppName").and_then(|x| x.as_str()) == Some(id))
                .ok_or(tr("Game not found.", "Game niet gevonden."))?;
            let s = |k: &str| m.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let triple = format!("{}%3A{}%3A{}", s("CatalogNamespace"), s("CatalogItemId"), s("AppName"));
            if !triple.chars().all(|c| c.is_ascii_alphanumeric() || c == '%' || c == '-' || c == '_') {
                return Err(tr("Unexpected Epic manifest data.", "Onverwachte Epic-gegevens.").into());
            }
            Ok(match action {
                "play" => format!("com.epicgames.launcher://apps/{triple}?action=launch&silent=true"),
                "verify" => format!("com.epicgames.launcher://apps/{triple}?action=verify"),
                "uninstall" => "com.epicgames.launcher://store/library".into(),
                _ => return Err(unknown()),
            })
        }
        "gog" => {
            if !id.chars().all(|c| c.is_ascii_digit()) {
                return Err(tr("Invalid GOG id.", "Ongeldige GOG-id.").into());
            }
            Ok(format!("goggalaxy://openGameView/{id}"))
        }
        "battlenet" => match action {
            "play" => Ok("battlenet://".into()),
            _ => Err(unknown()),
        },
        _ => Err(tr("Unknown launcher.", "Onbekende launcher.").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_library_folders() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "123" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        let p = library_paths(vdf);
        assert_eq!(p, vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"D:\SteamLibrary")]);
    }

    #[test]
    fn parses_app_manifest() {
        let acf = r#""AppState"
{
	"appid"		"1245620"
	"name"		"ELDEN RING"
	"installdir"		"ELDEN RING"
	"SizeOnDisk"		"65498845184"
	"LastPlayed"		"1728000000"
	"UserConfig" { "language" "english" }
}"#;
        let a = parse_manifest(acf).unwrap();
        assert_eq!((a.id.as_str(), a.name.as_str(), a.installdir.as_str()), ("1245620", "ELDEN RING", "ELDEN RING"));
        assert_eq!(a.size, 65_498_845_184);
        assert_eq!(a.last_played, Some(1_728_000_000));
    }

    #[test]
    fn launcher_urls_are_validated() {
        assert_eq!(action_url("steam", "730", "verify").unwrap(), "steam://validate/730");
        assert!(action_url("steam", "730; calc", "play").is_err());
        assert!(action_url("steam", "730", "format-c").is_err());
        assert!(action_url("gog", "12a", "play").is_err());
        assert!(action_url("evil", "1", "play").is_err());
    }
}
