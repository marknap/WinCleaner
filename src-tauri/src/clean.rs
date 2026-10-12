//! Junk cleaning: Windows temp files, launcher/browser caches, shader caches, old Windows installs, etc.

use crate::core::{self, ActionResult, Progress, RemovalRequest};
use crate::l10n::tr;
use crate::{diag, games, history, prefs, trf};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// Every child of each root is an item.
    Children,
    /// Only files directly in the root whose name starts with one of these.
    FilePrefix(&'static [&'static str]),
    /// Top-level node_modules in projects untouched for 90+ days.
    NodeModules,
    RecycleBin,
    /// hiberfil.sys, removed by turning hibernation off.
    Hibernation,
    /// Folders only Disk Cleanup may remove (TrustedInstaller-owned): (folder, VolumeCaches handler).
    DiskCleanup(&'static [(&'static str, &'static str)]),
}

struct Category {
    id: &'static str,
    name: &'static str,
    detail: &'static str,
    group: &'static str,
    roots: Vec<PathBuf>,
    kind: Kind,
    default_selected: bool,
    auto_clean: bool,
    warning: Option<&'static str>,
    owners: &'static [&'static str],
    admin: bool,
    min_age_hours: u64,
}

impl Category {
    fn new(id: &'static str, name: &'static str, group: &'static str, detail: &'static str, roots: Vec<PathBuf>) -> Self {
        Category { id, name, detail, group, roots, kind: Kind::Children, default_selected: true, auto_clean: true, warning: None, owners: &[], admin: false, min_age_hours: 0 }
    }
    fn kind(mut self, k: Kind) -> Self {
        self.kind = k;
        self
    }
    fn manual(mut self) -> Self {
        self.auto_clean = false;
        self
    }
    fn unticked(mut self) -> Self {
        self.default_selected = false;
        self.auto_clean = false;
        self
    }
    fn warn(mut self, w: &'static str) -> Self {
        self.warning = Some(w);
        self
    }
    fn owners(mut self, o: &'static [&'static str]) -> Self {
        self.owners = o;
        self
    }
    fn admin(mut self) -> Self {
        self.admin = true;
        self.auto_clean = false;
        self
    }
    fn min_age(mut self, h: u64) -> Self {
        self.min_age_hours = h;
        self
    }
}

/// Expand "A/B/*/C" or "A/webcache*" relative to `base` into existing folders.
fn glob(base: &Path, pattern: &str) -> Vec<PathBuf> {
    let mut cur = vec![base.to_path_buf()];
    for seg in pattern.split('/') {
        let mut next = vec![];
        for c in &cur {
            if let Some(prefix) = seg.strip_suffix('*') {
                let prefix = prefix.to_lowercase();
                if let Ok(rd) = fs::read_dir(c) {
                    for e in rd.flatten() {
                        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                        if is_dir && e.file_name().to_string_lossy().to_lowercase().starts_with(&prefix) {
                            next.push(e.path());
                        }
                    }
                }
            } else {
                next.push(c.join(seg));
            }
        }
        cur = next;
    }
    cur.into_iter().filter(|p| p.is_dir()).collect()
}

fn globs(base: &Path, patterns: &[&str]) -> Vec<PathBuf> {
    patterns.iter().flat_map(|p| glob(base, p)).collect()
}

fn chromium(base: &Path, user_data: &str) -> Vec<PathBuf> {
    let p = |s: &str| format!("{user_data}/{s}");
    globs(base, &[&p("*/Cache"), &p("*/Code Cache"), &p("*/GPUCache"), &p("*/Service Worker/CacheStorage"), &p("ShaderCache"), &p("GrShaderCache")])
}

const OLD_WINDOWS: &[(&str, &str)] = &[
    ("Windows.old", "Previous Installations"),
    ("$Windows.~BT", "Temporary Setup Files"),
    ("$Windows.~WS", "Temporary Setup Files"),
];

fn catalog() -> Vec<Category> {
    let local = core::local();
    let roaming = core::roaming();
    let pd = core::program_data();
    let win = core::windir();
    let sysdrive = core::system_drive();
    let steam = games::steam_root();
    let steam_libs = games::steam_libraries();

    let mut steam_web = glob(&local, "Steam/htmlcache");
    let mut steam_logs = vec![];
    if let Some(s) = &steam {
        steam_web.extend(glob(s, "appcache/httpcache"));
        steam_logs = globs(s, &["logs", "dumps"]);
    }
    let steam_shaders: Vec<PathBuf> = steam_libs.iter().flat_map(|l| glob(l, "steamapps/shadercache")).collect();
    let browser_detail = tr("Cached web pages, images and scripts.", "Gecachete webpagina's, afbeeldingen en scripts.");
    let launcher_cache = tr("Launcher web cache.", "Webcache van de launcher.");

    vec![
        // ---- Windows ----
        Category::new("usertemp", tr("Temporary files", "Tijdelijke bestanden"), "windows",
            tr("Leftovers from installers and apps. Anything used in the last 24 hours is kept.", "Restjes van installatieprogramma's en apps. Alles wat in de afgelopen 24 uur is gebruikt, blijft staan."),
            vec![std::env::temp_dir()]).min_age(24),
        Category::new("wintemp", tr("Windows temp files", "Tijdelijke Windows-bestanden"), "windows",
            tr("System-wide temporary files. Anything used in the last 24 hours is kept.", "Tijdelijke systeembestanden. Alles wat in de afgelopen 24 uur is gebruikt, blijft staan."),
            vec![win.join("Temp")]).min_age(24).admin(),
        Category::new("crashdumps", tr("App crash reports", "Crashrapporten van apps"), "windows",
            tr("Crash dumps and error reports from apps and games.", "Crashdumps en foutrapporten van apps en games."),
            globs(&local, &["CrashDumps", "Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue"])),
        Category::new("thumbs", tr("Thumbnail & icon cache", "Miniatuur- en pictogramcache"), "windows",
            tr("File Explorer rebuilds these as you browse. Files in use are skipped.", "Verkenner maakt deze opnieuw aan tijdens het bladeren. Bestanden in gebruik worden overgeslagen."),
            globs(&local, &["Microsoft/Windows/Explorer"])).kind(Kind::FilePrefix(&["thumbcache_", "iconcache_"])).manual(),
        Category::new("syscrash", tr("System crash dumps", "Systeemcrashdumps"), "windows",
            tr("Blue-screen and driver crash dumps.", "Crashdumps van blauwe schermen en stuurprogramma's."),
            {
                let mut v = globs(&win, &["Minidump", "LiveKernelReports"]);
                v.extend(globs(&pd, &["Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue"]));
                v
            }).admin().warn(tr("Only needed if you're troubleshooting blue screens.", "Alleen nodig als je blauwe schermen onderzoekt.")),
        Category::new("winupdate", tr("Windows Update downloads", "Windows Update-downloads"), "windows",
            tr("Update files that are already installed. Windows re-downloads anything it still needs.", "Updatebestanden die al zijn geïnstalleerd. Windows downloadt opnieuw wat nog nodig is."),
            globs(&win, &["SoftwareDistribution/Download"])).admin(),
        Category::new("delivery", tr("Delivery Optimization cache", "Cache voor leveringsoptimalisatie"), "windows",
            tr("Update pieces Windows shares with other PCs.", "Updatestukjes die Windows deelt met andere pc's."),
            globs(&win, &["ServiceProfiles/NetworkService/AppData/Local/Microsoft/Windows/DeliveryOptimization/Cache"])).admin(),
        Category::new("windowsold", tr("Previous Windows installation", "Vorige Windows-installatie"), "windows",
            tr("Windows.old and setup files left after a big Windows update. Often 20 GB or more.", "Windows.old en installatiebestanden van een grote Windows-update. Vaak 20 GB of meer."),
            vec![sysdrive.clone()]).kind(Kind::DiskCleanup(OLD_WINDOWS)).admin()
            .warn(tr("After this you can't go back to your previous Windows version. Removed with Windows Disk Cleanup.", "Hierna kun je niet meer terug naar je vorige Windows-versie. Wordt verwijderd met Windows Schijfopruiming.")),
        Category::new("hibernation", tr("Hibernation file", "Slaapstandbestand"), "windows",
            tr("hiberfil.sys is as big as a large part of your RAM. Desktops rarely need hibernation.", "hiberfil.sys is zo groot als een flink deel van je RAM. Desktops hebben sluimerstand zelden nodig."),
            vec![sysdrive.clone()]).kind(Kind::Hibernation).admin().unticked()
            .warn(tr("Turns off hibernation and Fast Startup. Not recommended on laptops. Undo with: powercfg /hibernate on", "Zet sluimerstand en Snel opstarten uit. Niet aangeraden op laptops. Terugdraaien: powercfg /hibernate on")),
        Category::new("recyclebin", tr("Recycle Bin", "Prullenbak"), "windows",
            tr("Everything currently in the Recycle Bin, on all drives.", "Alles wat nu in de Prullenbak staat, op alle stations."),
            vec![]).kind(Kind::RecycleBin).unticked()
            .warn(tr("Emptying it means files you recycled can't be put back.", "Na het legen kun je verwijderde bestanden niet meer terugzetten.")),
        // ---- Gaming ----
        Category::new("steamweb", tr("Steam web cache", "Steam-webcache"), "gaming",
            tr("Store pages, images and the in-game overlay browser cache.", "Winkelpagina's, afbeeldingen en de browsercache van de in-game overlay."),
            steam_web).owners(&["steam.exe", "steamwebhelper.exe"]),
        Category::new("steamlogs", tr("Steam logs & crash dumps", "Steam-logs en crashdumps"), "gaming",
            tr("Old Steam client logs and crash dumps.", "Oude logs en crashdumps van de Steam-client."), steam_logs),
        Category::new("epic", tr("Epic Games Launcher cache", "Cache van Epic Games Launcher"), "gaming",
            tr("Launcher web cache and logs.", "Webcache en logs van de launcher."),
            globs(&local, &["EpicGamesLauncher/Saved/webcache*", "EpicGamesLauncher/Saved/Logs"])).owners(&["epicgameslauncher.exe"]),
        Category::new("battlenet", tr("Battle.net cache", "Battle.net-cache"), "gaming", launcher_cache,
            globs(&local, &["Battle.net/Cache", "Battle.net/BrowserCaches"])).owners(&["battle.net.exe"]),
        Category::new("gog", tr("GOG Galaxy cache", "GOG Galaxy-cache"), "gaming", launcher_cache,
            globs(&pd, &["GOG.com/Galaxy/webcache"])).owners(&["galaxyclient.exe"]),
        Category::new("discord", tr("Discord cache", "Discord-cache"), "gaming",
            tr("Cached images, videos and emoji.", "Gecachete afbeeldingen, video's en emoji."),
            globs(&roaming, &["discord/Cache", "discord/Code Cache", "discord/GPUCache", "discordptb/Cache", "discordcanary/Cache"])).owners(&["discord.exe", "discordptb.exe", "discordcanary.exe"]),
        Category::new("driverinstallers", tr("Old GPU driver installers", "Oude installatiebestanden van GPU-drivers"), "gaming",
            tr("Setup files left behind by NVIDIA and AMD driver installs.", "Installatiebestanden die NVIDIA- en AMD-drivers achterlaten."),
            globs(&sysdrive, &["NVIDIA", "AMD"])).manual(),
        Category::new("nvidiadl", tr("NVIDIA driver downloads", "NVIDIA-driverdownloads"), "gaming",
            tr("Driver packages the NVIDIA app or GeForce Experience already installed.", "Driverpakketten die de NVIDIA-app of GeForce Experience al heeft geïnstalleerd."),
            globs(&pd, &["NVIDIA Corporation/Downloader"])).admin(),
        Category::new("shadercache", tr("GPU shader cache", "GPU-shadercache"), "gaming",
            tr("Compiled shaders from NVIDIA, AMD, Intel and DirectX.", "Gecompileerde shaders van NVIDIA, AMD, Intel en DirectX."),
            {
                let mut v = globs(&local, &["NVIDIA/DXCache", "NVIDIA/GLCache", "NVIDIA Corporation/NV_Cache", "D3DSCache", "AMD/DxCache", "AMD/DxcCache", "AMD/VkCache", "AMD/GLCache", "Intel/ShaderCache"]);
                v.extend(globs(&core::local_low(), &["NVIDIA/PerDriverVersion/DXCache", "NVIDIA/PerDriverVersion/GLCache"]));
                v
            }).unticked()
            .warn(tr("Games rebuild shaders on next launch (a bit of stutter at first). Great fix after a driver update or for graphical glitches.", "Games bouwen shaders opnieuw op bij de volgende start (eerst wat haperingen). Goede oplossing na een driverupdate of bij grafische fouten.")),
        Category::new("steamshader", tr("Steam shader pre-caches", "Steam-shadercaches"), "gaming",
            tr("Per-game shader caches Steam downloads or builds.", "Shadercaches per game die Steam downloadt of bouwt."),
            steam_shaders).unticked().owners(&["steam.exe"])
            .warn(tr("Steam rebuilds these. The first launch of each game may stutter.", "Steam bouwt deze opnieuw op. De eerste start van elke game kan haperen.")),
        // ---- Browsers ----
        Category::new("chrome", tr("Chrome cache", "Chrome-cache"), "browsers", browser_detail, chromium(&local, "Google/Chrome/User Data")).owners(&["chrome.exe"]),
        Category::new("edge", tr("Edge cache", "Edge-cache"), "browsers", browser_detail, chromium(&local, "Microsoft/Edge/User Data")).owners(&["msedge.exe"]),
        Category::new("brave", tr("Brave cache", "Brave-cache"), "browsers", browser_detail, chromium(&local, "BraveSoftware/Brave-Browser/User Data")).owners(&["brave.exe"]),
        Category::new("opera", tr("Opera / Opera GX cache", "Opera / Opera GX-cache"), "browsers", browser_detail,
            globs(&local, &["Opera Software/Opera GX Stable/Cache", "Opera Software/Opera Stable/Cache", "Opera Software/Opera GX Stable/Code Cache"])).owners(&["opera.exe"]),
        Category::new("firefox", tr("Firefox cache", "Firefox-cache"), "browsers", browser_detail, globs(&local, &["Mozilla/Firefox/Profiles/*/cache2"])).owners(&["firefox.exe"]),
        // ---- Developer ----
        Category::new("pkgcaches", tr("Package manager caches", "Caches van pakketbeheerders"), "developer",
            tr("npm, pip, Yarn, NuGet and Go download caches.", "Downloadcaches van npm, pip, Yarn, NuGet en Go."),
            globs(&local, &["npm-cache", "pip/cache", "Yarn/Cache", "NuGet/v3-cache", "go-build"])),
        Category::new("nodemodules", tr("Stale node_modules", "Verouderde node_modules"), "developer",
            tr("Dependencies of projects untouched for 90+ days. `npm install` restores them.", "Afhankelijkheden van projecten die 90+ dagen niet zijn aangeraakt. `npm install` zet ze terug."),
            node_project_roots()).kind(Kind::NodeModules).unticked(),
    ]
}

fn node_project_roots() -> Vec<PathBuf> {
    let h = core::home();
    let mut v: Vec<PathBuf> = ["Projects", "Developer", "Code", "source", "src", "dev", "work", "git", "repos", "GitHub"].iter().map(|d| h.join(d)).collect();
    if let Some(d) = dirs::document_dir() {
        v.push(d);
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub in_use: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanGroup {
    pub id: String,
    pub name: String,
    pub detail: String,
    pub group: String,
    pub warning: Option<String>,
    pub default_selected: bool,
    pub auto_clean: bool,
    pub needs_admin: bool,
    pub locked: bool,
    pub in_use: bool,
    pub total: u64,
    pub items: Vec<CleanItem>,
}

const RECYCLE_BIN: &str = "::recyclebin";
const HIBERFIL: &str = "hiberfil.sys";

pub fn scan(app: Option<AppHandle>, only_auto: bool) -> Vec<CleanGroup> {
    let progress = Progress::new(app, tr("Hunting for junk", "Op zoek naar rommel"));
    let running = core::running_processes();
    let admin = core::is_admin();
    let mut out = vec![];
    for c in catalog() {
        if core::cancelled() {
            break;
        }
        if only_auto && !c.auto_clean {
            continue;
        }
        progress.set_phase(&trf!("Scanning {}", "{} scannen", c.name));
        let in_use = c.owners.iter().any(|o| running.contains(*o));
        let locked = c.admin && !admin;
        let items = if locked { vec![] } else { scan_category(&c, in_use, &progress) };
        out.push(CleanGroup {
            id: c.id.into(),
            name: c.name.into(),
            detail: c.detail.into(),
            group: c.group.into(),
            warning: c.warning.map(String::from),
            default_selected: c.default_selected,
            auto_clean: c.auto_clean,
            needs_admin: c.admin,
            locked,
            in_use,
            total: items.iter().map(|i| i.size).sum(),
            items,
        });
    }
    out
}

fn hiberfil_size(root: &Path) -> u64 {
    // Read via the directory listing: opening the locked file itself can fail.
    fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(HIBERFIL))
        .and_then(|e| e.metadata().ok())
        .map(|m| m.len())
        .unwrap_or(0)
}

fn scan_category(c: &Category, in_use: bool, progress: &Progress) -> Vec<CleanItem> {
    let mut items = vec![];
    let min_age = core::now_secs().saturating_sub(c.min_age_hours * 3600);
    match c.kind {
        Kind::RecycleBin => {
            let (size, count) = recycle_bin_size();
            if count > 0 {
                items.push(CleanItem { path: RECYCLE_BIN.into(), name: trf!("{} items", "{} items", count), size, in_use: false });
            }
        }
        Kind::Hibernation => {
            for root in &c.roots {
                let size = hiberfil_size(root);
                if size > 0 {
                    items.push(CleanItem { path: root.join(HIBERFIL).display().to_string(), name: HIBERFIL.into(), size, in_use: false });
                }
            }
        }
        Kind::DiskCleanup(folders) => {
            for root in &c.roots {
                for (name, _) in folders {
                    let p = root.join(name);
                    if p.is_dir() {
                        let m = core::measure(&p, Some(progress));
                        items.push(CleanItem { path: p.display().to_string(), name: name.to_string(), size: m.size, in_use: false });
                    }
                }
            }
        }
        Kind::NodeModules => {
            for p in stale_node_modules(&c.roots) {
                let m = core::measure(&p, Some(progress));
                let project = p.parent().map(core::file_name).unwrap_or_default();
                items.push(CleanItem { path: p.display().to_string(), name: format!("{project}\\node_modules"), size: m.size, in_use: false });
            }
        }
        Kind::Children | Kind::FilePrefix(_) => {
            for root in &c.roots {
                let Ok(rd) = fs::read_dir(root) else { continue };
                for e in rd.flatten() {
                    if core::cancelled() {
                        return items;
                    }
                    let p = e.path();
                    if let Kind::FilePrefix(prefixes) = c.kind {
                        let n = e.file_name().to_string_lossy().to_lowercase();
                        if !prefixes.iter().any(|x| n.starts_with(x)) || !p.is_file() {
                            continue;
                        }
                    }
                    if core::is_excluded(&p) {
                        continue;
                    }
                    let m = core::measure(&p, Some(progress));
                    if c.min_age_hours > 0 && m.newest > min_age {
                        continue;
                    }
                    if m.size == 0 && p.is_file() {
                        continue;
                    }
                    items.push(CleanItem { name: core::file_name(&p), path: p.display().to_string(), size: m.size, in_use });
                }
            }
        }
    }
    items.sort_by_key(|i| std::cmp::Reverse(i.size));
    items
}

fn stale_node_modules(roots: &[PathBuf]) -> Vec<PathBuf> {
    let cutoff = core::now_secs().saturating_sub(90 * 86400);
    let mut found = vec![];
    for root in roots {
        let mut it = walkdir::WalkDir::new(root).max_depth(6).follow_links(false).into_iter();
        while let Some(Ok(e)) = it.next() {
            if core::cancelled() {
                return found;
            }
            if !e.file_type().is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy();
            if e.depth() > 0 && name.starts_with('.') {
                it.skip_current_dir();
                continue;
            }
            if name == "node_modules" {
                it.skip_current_dir();
                if let Some(project) = e.path().parent() {
                    if newest_outside_node_modules(project) < cutoff {
                        found.push(e.path().to_path_buf());
                    }
                }
            }
        }
    }
    found
}

fn newest_outside_node_modules(project: &Path) -> u64 {
    walkdir::WalkDir::new(project)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != ".git")
        .flatten()
        .filter_map(|e| e.metadata().ok()?.modified().ok().map(core::secs))
        .max()
        .unwrap_or(0)
}

fn is_stale_node_modules(p: &Path, roots: &[PathBuf]) -> bool {
    core::file_name(p) == "node_modules"
        && roots.iter().any(|r| core::strictly_inside(p, r))
        && !core::strictly_inside(p, &core::home().join("AppData"))
        && !p.parent().is_some_and(|parent| parent.ancestors().any(|a| core::file_name(a) == "node_modules"))
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CleanTarget {
    pub category: String,
    pub path: String,
    pub size: u64,
}

/// `tool` is a history id: "clean", "smart", "quick", "scheduled" or "shader".
pub fn clean(targets: Vec<CleanTarget>, tool: &str) -> ActionResult {
    let cats = catalog();
    let admin = core::is_admin();
    let permanent = !prefs::get().clean_to_recycle_bin;
    let mut result = ActionResult::default();
    let mut hist = vec![];
    let mut reqs = vec![];
    let mut allowed_paths = vec![];
    let mut disk_cleanup: Vec<(&Category, Vec<PathBuf>)> = vec![];

    for t in targets {
        let Some(c) = cats.iter().find(|c| c.id == t.category) else { continue };
        if c.admin && !admin {
            result.failed.push(trf!("{} needs admin rights.", "{} heeft beheerdersrechten nodig.", c.name));
            continue;
        }
        match c.kind {
            Kind::RecycleBin => {
                if t.path == RECYCLE_BIN {
                    let (size, _) = recycle_bin_size();
                    if empty_recycle_bin() {
                        result.freed += size;
                        result.removed += 1;
                        hist.push(crate::history::HistoryItem { path: tr("Recycle Bin", "Prullenbak").into(), size, recycled: false, restored: false, backup: None });
                    } else {
                        result.failed.push(tr("Couldn't empty the Recycle Bin.", "Kon de Prullenbak niet legen.").into());
                    }
                }
            }
            Kind::Hibernation => {
                let root = &c.roots[0];
                if !core::same_path(Path::new(&t.path), &root.join(HIBERFIL)) {
                    continue;
                }
                let size = hiberfil_size(root);
                let powercfg = core::windir().join(r"System32\powercfg.exe").display().to_string();
                match core::run(&powercfg, &["/hibernate", "off"]) {
                    Ok((0, _)) => {
                        result.freed += size;
                        result.removed += 1;
                        hist.push(crate::history::HistoryItem { path: t.path.clone(), size, recycled: false, restored: false, backup: None });
                        diag::info("Hibernation turned off");
                    }
                    Ok((_, out)) => result.failed.push(out.trim().to_string()),
                    Err(e) => result.failed.push(e),
                }
            }
            Kind::DiskCleanup(folders) => {
                let p = PathBuf::from(&t.path);
                let ok = c.roots.iter().any(|r| core::direct_child(&p, r)) && folders.iter().any(|(n, _)| core::file_name(&p).eq_ignore_ascii_case(n));
                if ok {
                    match disk_cleanup.iter_mut().find(|(cat, _)| cat.id == c.id) {
                        Some((_, v)) => v.push(p),
                        None => disk_cleanup.push((c, vec![p])),
                    }
                }
            }
            _ => {
                let p = PathBuf::from(&t.path);
                if !is_cleanable(c, &p) {
                    result.failed.push(trf!("Blocked by safety rules: {}", "Geblokkeerd door veiligheidsregels: {}", t.path));
                    continue;
                }
                allowed_paths.push((c.id, p.clone()));
                reqs.push(RemovalRequest { path: p, size: t.size, permanent });
            }
        }
    }

    for (c, paths) in disk_cleanup {
        if let Kind::DiskCleanup(folders) = c.kind {
            match run_disk_cleanup(folders, &paths) {
                Ok(freed) => {
                    result.freed += freed;
                    result.removed += paths.len() as u64;
                    hist.extend(paths.iter().map(|p| crate::history::HistoryItem::new(p, freed / paths.len() as u64, false)));
                }
                Err(e) => result.failed.push(e),
            }
        }
    }

    let out = core::remove(reqs, &|p| allowed_paths.iter().any(|(id, ap)| ap == p && cats.iter().any(|c| c.id == *id && is_cleanable(c, p))));
    result.freed += out.result.freed;
    result.removed += out.result.removed;
    result.skipped += out.result.skipped;
    result.failed.extend(out.result.failed);
    hist.extend(out.history);
    history::record(tool, hist);
    result.message = core::summary(&result);
    result
}

/// Windows.old is owned by TrustedInstaller, so we let Disk Cleanup remove it,
/// using a temporary "sageset" profile (StateFlags0042).
#[cfg(windows)]
fn run_disk_cleanup(folders: &[(&str, &str)], paths: &[PathBuf]) -> Result<u64, String> {
    use winreg::enums::*;
    const BASE: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches";
    let before: u64 = paths.iter().map(|p| core::measure(p, None).size).sum();
    let handlers: Vec<&str> = folders.iter().filter(|(n, _)| paths.iter().any(|p| core::file_name(p).eq_ignore_ascii_case(n))).map(|(_, h)| *h).collect();
    let hklm = winreg::RegKey::predef(HKEY_LOCAL_MACHINE);
    for h in &handlers {
        if let Ok(k) = hklm.open_subkey_with_flags(format!("{BASE}\\{h}"), KEY_SET_VALUE) {
            let _ = k.set_value("StateFlags0042", &2u32);
        }
    }
    let cleanmgr = core::windir().join(r"System32\cleanmgr.exe").display().to_string();
    let r = core::run(&cleanmgr, &["/sagerun:42"]);
    for h in &handlers {
        if let Ok(k) = hklm.open_subkey_with_flags(format!("{BASE}\\{h}"), KEY_SET_VALUE) {
            let _ = k.delete_value("StateFlags0042");
        }
    }
    r?;
    let after: u64 = paths.iter().filter(|p| p.exists()).map(|p| core::measure(p, None).size).sum();
    diag::info(format!("Disk Cleanup freed {}", core::format_bytes(before.saturating_sub(after))));
    Ok(before.saturating_sub(after))
}
#[cfg(not(windows))]
fn run_disk_cleanup(_folders: &[(&str, &str)], _paths: &[PathBuf]) -> Result<u64, String> {
    Err("Windows only".into())
}

fn is_cleanable(c: &Category, p: &Path) -> bool {
    match c.kind {
        Kind::RecycleBin | Kind::Hibernation | Kind::DiskCleanup(_) => false,
        Kind::NodeModules => is_stale_node_modules(p, &c.roots),
        Kind::Children => c.roots.iter().any(|r| core::direct_child(p, r)),
        Kind::FilePrefix(prefixes) => {
            let n = core::file_name(p).to_lowercase();
            prefixes.iter().any(|x| n.starts_with(x)) && c.roots.iter().any(|r| core::direct_child(p, r))
        }
    }
}

/// Headless clean used by the scheduled task (`--auto-clean`).
pub fn auto_clean() -> String {
    core::begin_job();
    let groups = scan(None, true);
    let targets: Vec<CleanTarget> = groups
        .iter()
        .filter(|g| g.default_selected && !g.locked)
        .flat_map(|g| g.items.iter().filter(|i| !i.in_use).map(|i| CleanTarget { category: g.id.clone(), path: i.path.clone(), size: i.size }))
        .collect();
    clean(targets, "scheduled").message
}

// ---------------------------------------------------------------------------
// Recycle Bin
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn recycle_bin_size() -> (u64, u64) {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    unsafe {
        let mut info: SHQUERYRBINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
        if SHQueryRecycleBinW(std::ptr::null(), &mut info) == 0 {
            (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
        } else {
            (0, 0)
        }
    }
}

#[cfg(windows)]
fn empty_recycle_bin() -> bool {
    use windows_sys::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
    unsafe {
        let hr = SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND);
        // S_OK, or E_UNEXPECTED when it was already empty.
        hr == 0 || hr as u32 == 0x8000_FFFF
    }
}

#[cfg(not(windows))]
fn recycle_bin_size() -> (u64, u64) {
    (0, 0)
}
#[cfg(not(windows))]
fn empty_recycle_bin() -> bool {
    false
}

/// Used by Boost's "Reset shader cache".
pub fn clear_shader_cache() -> ActionResult {
    let cats = catalog();
    let Some(c) = cats.iter().find(|c| c.id == "shadercache") else { return ActionResult::default() };
    let targets: Vec<CleanTarget> = c
        .roots
        .iter()
        .flat_map(|r| fs::read_dir(r).into_iter().flatten().flatten())
        .map(|e| CleanTarget { category: "shadercache".into(), path: e.path().display().to_string(), size: core::measure(&e.path(), None).size })
        .collect();
    clean(targets, "shader")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_expands_prefix_and_star() {
        let base = std::env::temp_dir().join(format!("wincleaner-glob-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        for d in ["A/webcache_1", "A/webcache_2", "A/other", "U/Default/Cache", "U/Profile 1/Cache"] {
            fs::create_dir_all(base.join(d)).unwrap();
        }
        assert_eq!(glob(&base, "A/webcache*").len(), 2);
        assert_eq!(glob(&base, "U/*/Cache").len(), 2);
        assert!(glob(&base, "missing/Cache").is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn children_must_be_direct() {
        let base = std::env::temp_dir().join(format!("wincleaner-cleanable-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("x/y")).unwrap();
        let c = Category::new("t", "t", "windows", "t", vec![base.clone()]);
        assert!(is_cleanable(&c, &base.join("x")));
        assert!(!is_cleanable(&c, &base.join("x/y")));
        assert!(!is_cleanable(&c, &base));
        let _ = fs::remove_dir_all(&base);
    }
}
