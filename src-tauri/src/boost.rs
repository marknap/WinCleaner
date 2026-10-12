//! Game Boost, quick fixes and reversible gaming tweaks.

use crate::core::{self, run};
use crate::history::{self, Counter};
use crate::l10n::tr;
use crate::{clean, diag, prefs, trf};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub id: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub admin: bool,
    pub slow: bool,
    pub advanced: bool,
    pub reboot: bool,
}

pub fn fixes() -> Vec<Fix> {
    let f = |id, name, detail, admin, slow, advanced, reboot| Fix { id, name, detail, admin, slow, advanced, reboot };
    vec![
        f("dns", tr("Flush DNS cache", "DNS-cache legen"), tr("Fixes \"can't connect to server\" after network or DNS changes.", "Lost \"kan geen verbinding maken met server\" op na netwerk- of DNS-wijzigingen."), false, false, false, false),
        f("ram", tr("Free standby memory", "Standby-geheugen vrijmaken"), tr("Releases cached RAM so your game gets it right away. Helps with stutter on 8-16 GB PCs.", "Geeft gecachet RAM vrij zodat je game het direct krijgt. Helpt tegen haperingen op pc's met 8-16 GB."), true, false, false, false),
        f("shaders", tr("Reset GPU shader cache", "GPU-shadercache resetten"), tr("Fixes stutter and glitches after a driver update. Games rebuild shaders on next launch.", "Lost haperingen en grafische fouten op na een driverupdate. Games bouwen shaders opnieuw op."), false, false, false, false),
        f("icons", tr("Rebuild icon cache", "Pictogramcache herbouwen"), tr("Fixes blank or wrong icons on the desktop and taskbar.", "Lost lege of verkeerde pictogrammen op het bureaublad en de taakbalk op."), false, false, false, false),
        f("explorer", tr("Restart Explorer", "Verkenner herstarten"), tr("Fixes a frozen taskbar, Start menu or desktop.", "Lost een vastgelopen taakbalk, Startmenu of bureaublad op."), false, false, false, false),
        f("time", tr("Sync the clock", "Klok synchroniseren"), tr("Some launchers and anti-cheat fail when the clock is off.", "Sommige launchers en anticheat werken niet als de klok verkeerd staat."), true, false, true, false),
        f("network", tr("Reset network stack", "Netwerkinstellingen resetten"), tr("Last resort for broken internet. Needs a restart.", "Laatste redmiddel bij kapot internet. Vereist een herstart."), true, false, true, true),
        f("trim", tr("Optimize drives (TRIM)", "Stations optimaliseren (TRIM)"), tr("Keeps SSDs fast. Can take a few minutes.", "Houdt SSD's snel. Kan een paar minuten duren."), true, true, true, false),
        f("dism", tr("Clean up Windows components", "Windows-onderdelen opruimen"), tr("Removes superseded Windows Update files. Takes several minutes.", "Verwijdert vervangen Windows Update-bestanden. Duurt enkele minuten."), true, true, true, false),
        f("sfc", tr("Repair Windows system files", "Windows-systeembestanden herstellen"), tr("Scans and repairs Windows. Can take 10-20 minutes.", "Scant en herstelt Windows. Kan 10-20 minuten duren."), true, true, true, false),
    ]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixResult {
    pub ok: bool,
    pub message: String,
}

fn ok(msg: impl Into<String>) -> FixResult {
    FixResult { ok: true, message: msg.into() }
}
fn fail(msg: impl Into<String>) -> FixResult {
    FixResult { ok: false, message: msg.into() }
}

fn check(r: Result<(i32, String), String>, success: &str) -> FixResult {
    match r {
        Ok((0, _)) => ok(success),
        Ok((code, out)) => fail(trf!(
            "Exited with code {}. {}",
            "Gestopt met code {}. {}",
            code,
            out.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim()
        )),
        Err(e) => fail(e),
    }
}

pub fn run_fix(id: &str) -> FixResult {
    let Some(fix) = fixes().into_iter().find(|f| f.id == id) else { return fail(tr("Unknown fix", "Onbekende oplossing")) };
    if fix.admin && !core::is_admin() {
        return fail(tr("Needs admin rights.", "Heeft beheerdersrechten nodig."));
    }
    if fix.reboot {
        let _ = core::restore_point(false);
    }
    let sys32 = core::windir().join("System32");
    let exe = |n: &str| sys32.join(n).display().to_string();
    let r = match id {
        "dns" => check(run(&exe("ipconfig.exe"), &["/flushdns"]), tr("DNS cache flushed", "DNS-cache geleegd")),
        "ram" => match purge_standby() {
            Ok(freed) => ok(trf!("Freed {} of standby memory", "{} standby-geheugen vrijgemaakt", core::format_bytes(freed))),
            Err(e) => fail(e),
        },
        "shaders" => {
            let r = clean::clear_shader_cache();
            if r.failed.is_empty() { ok(r.message) } else { fail(r.message) }
        }
        "icons" => check(run(&exe("ie4uinit.exe"), &["-show"]), tr("Icon cache rebuilt", "Pictogramcache herbouwd")),
        "explorer" => {
            let _ = run(&exe("taskkill.exe"), &["/F", "/IM", "explorer.exe"]);
            std::thread::sleep(std::time::Duration::from_millis(800));
            match std::process::Command::new(core::windir().join("explorer.exe")).spawn() {
                Ok(_) => ok(tr("Explorer restarted", "Verkenner herstart")),
                Err(e) => fail(trf!("Couldn't start Explorer: {}", "Kon Verkenner niet starten: {}", e)),
            }
        }
        "time" => {
            let _ = run(&exe("net.exe"), &["start", "w32time"]);
            check(run(&exe("w32tm.exe"), &["/resync", "/force"]), tr("Clock synced", "Klok gesynchroniseerd"))
        }
        "network" => {
            let a = run(&exe("netsh.exe"), &["winsock", "reset"]);
            let b = run(&exe("netsh.exe"), &["int", "ip", "reset"]);
            if matches!(a, Ok((0, _))) && b.is_ok() {
                ok(tr("Network reset. Restart your PC to finish.", "Netwerk gereset. Herstart je pc om af te ronden."))
            } else {
                check(a, "")
            }
        }
        "trim" => check(run(&exe("defrag.exe"), &["/C", "/O", "/H"]), tr("Drives optimized", "Stations geoptimaliseerd")),
        "dism" => check(run(&exe("Dism.exe"), &["/Online", "/Cleanup-Image", "/StartComponentCleanup"]), tr("Windows components cleaned up", "Windows-onderdelen opgeruimd")),
        "sfc" => check(run(&exe("sfc.exe"), &["/scannow"]), tr("System file check finished", "Controle van systeembestanden voltooid")),
        _ => fail(tr("Unknown fix", "Onbekende oplossing")),
    };
    diag::info(format!("Fix {id}: ok={} {}", r.ok, r.message));
    r
}

// ---------------------------------------------------------------------------
// Standby memory purge (same technique as RAMMap / ISLC)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn enable_privilege(name: &str) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, LUID};
    use windows_sys::Win32::Security::{AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut luid: LUID = std::mem::zeroed();
        let n = core::wide(name);
        let mut okk = LookupPrivilegeValueW(std::ptr::null(), n.as_ptr(), &mut luid) != 0;
        if okk {
            let tp = TOKEN_PRIVILEGES { PrivilegeCount: 1, Privileges: [LUID_AND_ATTRIBUTES { Luid: luid, Attributes: SE_PRIVILEGE_ENABLED }] };
            okk = AdjustTokenPrivileges(token, 0, &tp, 0, std::ptr::null_mut(), std::ptr::null_mut()) != 0 && GetLastError() == 0;
        }
        CloseHandle(token);
        okk
    }
}

#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtSetSystemInformation(class: i32, info: *mut std::ffi::c_void, len: u32) -> i32;
}

#[cfg(windows)]
fn purge_standby() -> Result<u64, String> {
    const SYSTEM_MEMORY_LIST_INFORMATION: i32 = 80;
    let before = available_memory();
    if !enable_privilege("SeProfileSingleProcessPrivilege") {
        return Err(tr("Windows didn't grant the memory privilege.", "Windows gaf geen toestemming voor het geheugen.").into());
    }
    let mut cmd: i32 = 4; // MemoryPurgeStandbyList
    let status = unsafe { NtSetSystemInformation(SYSTEM_MEMORY_LIST_INFORMATION, &mut cmd as *mut i32 as *mut _, 4) };
    if status != 0 {
        return Err(trf!("Windows refused (status {:#x}).", "Windows weigerde (status {:#x}).", status));
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    Ok(available_memory().saturating_sub(before))
}
#[cfg(not(windows))]
fn purge_standby() -> Result<u64, String> {
    Err("Windows only".into())
}

fn available_memory() -> u64 {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    s.available_memory()
}

// ---------------------------------------------------------------------------
// Tweaks (each one reads live state and can be switched back)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tweak {
    pub id: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub on: bool,
    pub recommended: bool,
    pub admin: bool,
    pub reboot: bool,
    pub advanced: bool,
}

const SCHEME_HIGH: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635b";
const SCHEME_ULTIMATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";
const SCHEME_BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

pub fn tweaks() -> Vec<Tweak> {
    vec![
        Tweak { id: "gamemode", name: tr("Windows Game Mode", "Windows-gamemodus"), detail: tr("Windows prioritizes your game and pauses updates while you play.", "Windows geeft je game voorrang en pauzeert updates tijdens het spelen."), on: game_mode(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "nodvr", name: tr("Turn off background recording", "Achtergrondopname uitzetten"), detail: tr("Stops Xbox Game Bar from silently recording gameplay, which costs FPS.", "Voorkomt dat Xbox Game Bar stilletjes gameplay opneemt, wat FPS kost."), on: dvr_off(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "highperf", name: tr("High performance power plan", "Energiebeheerschema Hoge prestaties"), detail: tr("Keeps your CPU at full speed. Uses more power on laptops.", "Houdt je CPU op volle snelheid. Verbruikt meer stroom op laptops."), on: high_perf(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "rawmouse", name: tr("Turn off mouse acceleration", "Muisversnelling uitzetten"), detail: tr("Disables \"Enhance pointer precision\" for consistent aim.", "Zet \"Verbeterde aanwijzerprecisie\" uit voor consistent richten."), on: mouse_raw(), recommended: true, admin: false, reboot: false, advanced: true },
        Tweak { id: "hags", name: tr("Hardware-accelerated GPU scheduling", "Hardwareversnelde GPU-planning"), detail: tr("Lets your GPU manage its own memory. Required for DLSS Frame Generation.", "Laat je GPU zijn eigen geheugen beheren. Vereist voor DLSS Frame Generation."), on: hags(), recommended: true, admin: true, reboot: true, advanced: true },
    ]
}

pub fn set_tweak(id: &str, on: bool) -> Result<(), String> {
    let _ = core::restore_point(false);
    let r = match id {
        "gamemode" => reg_set_dword(false, "Software\\Microsoft\\GameBar", "AutoGameModeEnabled", on as u32),
        "nodvr" => {
            reg_set_dword(false, "System\\GameConfigStore", "GameDVR_Enabled", (!on) as u32)?;
            reg_set_dword(false, "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "AppCaptureEnabled", (!on) as u32)
        }
        "highperf" => set_high_perf(on),
        "rawmouse" => set_mouse_raw(on),
        "hags" => {
            if !core::is_admin() {
                return Err(tr("Needs admin rights.", "Heeft beheerdersrechten nodig.").into());
            }
            reg_set_dword(true, "SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "HwSchMode", if on { 2 } else { 1 })
        }
        _ => Err(tr("Unknown setting", "Onbekende instelling").into()),
    };
    diag::info(format!("Tweak {id} -> {on}: {r:?}"));
    if r.is_ok() && on {
        history::bump(Counter::Tweak);
    }
    r
}

#[cfg(windows)]
fn reg_get_dword(machine: bool, path: &str, name: &str) -> Option<u32> {
    use winreg::enums::*;
    winreg::RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER }).open_subkey(path).ok()?.get_value(name).ok()
}
#[cfg(windows)]
fn reg_set_dword(machine: bool, path: &str, name: &str, v: u32) -> Result<(), String> {
    use winreg::enums::*;
    let (k, _) = winreg::RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER }).create_subkey(path).map_err(|e| e.to_string())?;
    k.set_value(name, &v).map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn reg_get_dword(_m: bool, _p: &str, _n: &str) -> Option<u32> {
    None
}
#[cfg(not(windows))]
fn reg_set_dword(_m: bool, _p: &str, _n: &str, _v: u32) -> Result<(), String> {
    Err("Windows only".into())
}

fn game_mode() -> bool {
    reg_get_dword(false, "Software\\Microsoft\\GameBar", "AutoGameModeEnabled").unwrap_or(1) == 1
}
fn dvr_off() -> bool {
    reg_get_dword(false, "System\\GameConfigStore", "GameDVR_Enabled").unwrap_or(1) == 0
}
fn hags() -> bool {
    reg_get_dword(true, "SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "HwSchMode").unwrap_or(1) == 2
}

fn powercfg(args: &[&str]) -> Result<(i32, String), String> {
    run(&core::windir().join(r"System32\powercfg.exe").display().to_string(), args)
}

/// First GUID in `s`. powercfg output is localized, GUIDs are not.
fn find_guid(s: &str) -> Option<String> {
    let b = s.as_bytes();
    (0..b.len().saturating_sub(35)).find_map(|i| {
        let c = s.get(i..i + 36)?;
        let ok = c.char_indices().all(|(j, ch)| if [8, 13, 18, 23].contains(&j) { ch == '-' } else { ch.is_ascii_hexdigit() });
        ok.then(|| c.to_lowercase())
    })
}

fn active_scheme() -> Option<String> {
    powercfg(&["/getactivescheme"]).ok().and_then(|(_, o)| find_guid(&o))
}

/// Compared by GUID only, so it works on every Windows language.
fn is_boost_guid(guid: &str, own: Option<&str>) -> bool {
    guid == SCHEME_HIGH || guid == SCHEME_ULTIMATE || own.is_some_and(|o| o == guid)
}

fn high_perf() -> bool {
    let a = active_scheme().unwrap_or_default();
    is_boost_guid(&a, prefs::get().boost_scheme.as_deref())
}

fn set_high_perf(on: bool) -> Result<(), String> {
    let p = prefs::get();
    if on {
        if let Some(c) = active_scheme() {
            if !is_boost_guid(&c, p.boost_scheme.as_deref()) {
                prefs::update(|p| p.prev_power_scheme = Some(c));
            }
        }
        if matches!(powercfg(&["/setactive", SCHEME_HIGH]), Ok((0, _))) {
            return Ok(());
        }
        // Many laptops hide High performance. Reuse our own copy, or create one from the template.
        if let Some(own) = p.boost_scheme.as_deref() {
            if matches!(powercfg(&["/setactive", own]), Ok((0, _))) {
                return Ok(());
            }
        }
        let (_, out) = powercfg(&["/duplicatescheme", SCHEME_HIGH])?;
        let guid = find_guid(&out).ok_or(tr("This PC doesn't offer a High performance plan.", "Deze pc biedt geen schema Hoge prestaties."))?;
        prefs::update(|p| p.boost_scheme = Some(guid.clone()));
        match powercfg(&["/setactive", &guid])? {
            (0, _) => Ok(()),
            (_, o) => Err(o.trim().to_string()),
        }
    } else {
        let target = p.prev_power_scheme.unwrap_or_else(|| SCHEME_BALANCED.into());
        if find_guid(&target).is_none() {
            return Err("Invalid saved power plan".into());
        }
        let r = powercfg(&["/setactive", &target])?;
        if r.0 != 0 {
            powercfg(&["/setactive", SCHEME_BALANCED])?;
        }
        prefs::update(|p| p.prev_power_scheme = None);
        Ok(())
    }
}

#[cfg(windows)]
fn mouse_params() -> [i32; 3] {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETMOUSE};
    let mut v = [6i32, 10, 1];
    unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, v.as_mut_ptr() as *mut _, 0) };
    v
}
#[cfg(windows)]
fn mouse_raw() -> bool {
    mouse_params()[2] == 0
}
#[cfg(windows)]
fn set_mouse_raw(on: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETMOUSE};
    let mut v: [i32; 3] = if on { [0, 0, 0] } else { [6, 10, 1] };
    let r = unsafe { SystemParametersInfoW(SPI_SETMOUSE, 0, v.as_mut_ptr() as *mut _, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE) };
    if r != 0 { Ok(()) } else { Err(tr("Windows rejected the mouse setting.", "Windows weigerde de muisinstelling.").into()) }
}
#[cfg(not(windows))]
fn mouse_raw() -> bool {
    false
}
#[cfg(not(windows))]
fn set_mouse_raw(_on: bool) -> Result<(), String> {
    Err("Windows only".into())
}

// ---------------------------------------------------------------------------
// Game Boost
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub name: String,
    pub label: String,
    pub memory: u64,
    pub count: usize,
    pub selected: bool,
    pub suggested: bool,
}

/// Never offered for closing: Windows itself, drivers, anti-cheat, voice chat, us.
const NEVER_CLOSE: &[&str] = &[
    "system", "registry", "idle", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "svchost.exe",
    "explorer.exe", "dwm.exe", "fontdrvhost.exe", "sihost.exe", "ctfmon.exe", "runtimebroker.exe", "searchhost.exe", "searchapp.exe",
    "startmenuexperiencehost.exe", "shellexperiencehost.exe", "textinputhost.exe", "taskhostw.exe", "dllhost.exe", "conhost.exe",
    "audiodg.exe", "spoolsv.exe", "securityhealthsystray.exe", "securityhealthservice.exe", "msmpeng.exe", "nissrv.exe",
    "wincleaner.exe", "msedgewebview2.exe", "nvcontainer.exe", "nvdisplay.container.exe", "amdrsserv.exe", "radeonsoftware.exe",
    "discord.exe", "steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "battle.net.exe", "galaxyclient.exe", "eadesktop.exe",
    "riotclientservices.exe", "vgtray.exe", "vgc.exe", "easyanticheat.exe", "beservice.exe", "faceit.exe", "obs64.exe",
    "lghub.exe", "lghub_agent.exe", "razer synapse 3.exe", "icue.exe", "msiafterburner.exe", "rtss.exe", "taskmgr.exe",
    "applicationframehost.exe", "lockapp.exe", "wudfhost.exe", "smartscreen.exe", "memory compression", "secure system",
    "presentmon.exe",
];

const SUGGESTED: &[(&str, &str)] = &[
    ("onedrive.exe", "OneDrive"),
    ("ms-teams.exe", "Microsoft Teams"),
    ("teams.exe", "Microsoft Teams"),
    ("skype.exe", "Skype"),
    ("slack.exe", "Slack"),
    ("zoom.exe", "Zoom"),
    ("dropbox.exe", "Dropbox"),
    ("googledrivefs.exe", "Google Drive"),
    ("creative cloud.exe", "Adobe Creative Cloud"),
    ("adobe desktop service.exe", "Adobe Desktop Service"),
    ("ccxprocess.exe", "Adobe CCX"),
    ("acrocef.exe", "Adobe Acrobat"),
    ("overwolf.exe", "Overwolf"),
    ("utorrent.exe", "uTorrent"),
    ("qbittorrent.exe", "qBittorrent"),
    ("phoneexperiencehost.exe", "Phone Link"),
    ("widgets.exe", "Windows Widgets"),
];

pub fn candidates() -> Vec<Candidate> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_memory().with_exe(UpdateKind::OnlyIfNotSet));
    let win = core::windir().display().to_string().to_lowercase();
    let chosen = prefs::get().boost_close;
    let mut by_name: HashMap<String, (u64, usize)> = HashMap::new();
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_lowercase();
        if NEVER_CLOSE.contains(&name.as_str()) || name.starts_with("presentmon") {
            continue;
        }
        let Some(exe) = p.exe() else { continue };
        if exe.display().to_string().to_lowercase().starts_with(&win) {
            continue;
        }
        let e = by_name.entry(name).or_insert((0, 0));
        e.0 += p.memory();
        e.1 += 1;
    }
    let mut out: Vec<Candidate> = by_name
        .into_iter()
        .filter(|(n, (mem, _))| *mem >= 40 * 1024 * 1024 || SUGGESTED.iter().any(|(s, _)| s == n))
        .map(|(name, (memory, count))| {
            let known = SUGGESTED.iter().find(|(s, _)| *s == name);
            let suggested = known.is_some();
            Candidate {
                label: known.map(|(_, l)| l.to_string()).unwrap_or_else(|| name.trim_end_matches(".exe").to_string()),
                selected: if chosen.is_empty() { suggested } else { chosen.contains(&name) },
                name,
                memory,
                count,
                suggested,
            }
        })
        .collect();
    out.sort_by(|a, b| b.suggested.cmp(&a.suggested).then(b.memory.cmp(&a.memory)));
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostStep {
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostReport {
    pub steps: Vec<BoostStep>,
    pub ram_freed: u64,
}

pub fn game_boost(close: Vec<String>) -> BoostReport {
    let before = available_memory();
    let mut steps = vec![];
    let step = |label: &str, r: FixResult| BoostStep { label: label.into(), ok: r.ok, detail: r.message };

    if prefs::get().restore_points && core::is_admin() {
        match core::restore_point(false) {
            Ok(m) if !m.is_empty() => steps.push(step(tr("Restore point", "Herstelpunt"), ok(m))),
            Ok(_) => {}
            Err(e) => steps.push(step(tr("Restore point", "Herstelpunt"), fail(e))),
        }
    }

    // Close the background apps the user picked (politely, like clicking X).
    let allowed: Vec<String> = candidates().into_iter().map(|c| c.name).collect();
    let close: Vec<String> = close.into_iter().map(|c| c.to_lowercase()).filter(|c| allowed.contains(c)).collect();
    prefs::update(|p| p.boost_close = close.clone());
    let taskkill = core::windir().join(r"System32\taskkill.exe").display().to_string();
    let mut closed = 0;
    for name in &close {
        if matches!(run(&taskkill, &["/IM", name]), Ok((0, _))) {
            closed += 1;
        }
    }
    if !close.is_empty() {
        steps.push(BoostStep {
            label: tr("Closed background apps", "Achtergrondapps gesloten").into(),
            ok: closed > 0,
            detail: trf!(
                "{} of {} closed. Apps that only live in the tray may need closing by hand.",
                "{} van {} gesloten. Apps die alleen in het systeemvak staan, moet je misschien zelf sluiten.",
                closed,
                close.len()
            ),
        });
    }
    let already = tr("Already on", "Stond al aan");
    let enabled = tr("Enabled", "Ingeschakeld");
    if !high_perf() {
        steps.push(step(tr("High performance power", "Hoge prestaties"), set_high_perf(true).map(|_| ok(enabled)).unwrap_or_else(fail)));
    } else {
        steps.push(step(tr("High performance power", "Hoge prestaties"), ok(already)));
    }
    if !game_mode() {
        steps.push(step(tr("Game Mode", "Gamemodus"), set_tweak("gamemode", true).map(|_| ok(enabled)).unwrap_or_else(fail)));
    } else {
        steps.push(step(tr("Game Mode", "Gamemodus"), ok(already)));
    }
    steps.push(step(tr("Flush DNS", "DNS legen"), run_fix("dns")));
    if core::is_admin() {
        steps.push(step(tr("Free standby memory", "Standby-geheugen vrijmaken"), run_fix("ram")));
    } else {
        steps.push(step(tr("Free standby memory", "Standby-geheugen vrijmaken"), fail(tr("Skipped (needs admin)", "Overgeslagen (beheerder nodig)"))));
    }
    std::thread::sleep(std::time::Duration::from_millis(1200));
    let ram_freed = available_memory().saturating_sub(before);
    prefs::update(|p| p.boost_active = true);
    history::bump(Counter::Boost);
    diag::info(format!("Game Boost: closed {closed}, freed {}", core::format_bytes(ram_freed)));
    BoostReport { steps, ram_freed }
}

pub fn boost_restore() -> Result<(), String> {
    let r = if prefs::get().prev_power_scheme.is_some() { set_high_perf(false) } else { Ok(()) };
    prefs::update(|p| p.boost_active = false);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_guid_in_any_language() {
        let en = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)";
        let nl = "GUID van energiebeheerschema: 381B4222-F694-41F0-9685-FF5BB260DF2E  (Gebalanceerd)";
        assert_eq!(find_guid(en).as_deref(), Some(SCHEME_BALANCED));
        assert_eq!(find_guid(nl).as_deref(), Some(SCHEME_BALANCED));
        assert_eq!(find_guid("no guid here"), None);
        assert_eq!(find_guid("ÄÖÜ 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635b").as_deref(), Some(SCHEME_HIGH));
    }

    #[test]
    fn boost_guid_detection() {
        assert!(is_boost_guid(SCHEME_HIGH, None));
        assert!(is_boost_guid("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")));
        assert!(!is_boost_guid(SCHEME_BALANCED, None));
    }
}
