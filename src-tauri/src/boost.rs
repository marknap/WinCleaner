//! Game Boost, quick fixes and reversible gaming tweaks.

use crate::core::{self, run};
use crate::{clean, history, prefs};
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
        f("dns", "Flush DNS cache", "Fixes \"can't connect to server\" after network or DNS changes.", false, false, false, false),
        f("ram", "Free standby memory", "Releases cached RAM so your game gets it right away. Helps with stutter on 8-16 GB PCs.", true, false, false, false),
        f("shaders", "Reset GPU shader cache", "Fixes stutter and glitches after a driver update. Games rebuild shaders on next launch.", false, false, false, false),
        f("icons", "Rebuild icon cache", "Fixes blank or wrong icons on the desktop and taskbar.", false, false, false, false),
        f("explorer", "Restart Explorer", "Fixes a frozen taskbar, Start menu or desktop.", false, false, false, false),
        f("time", "Sync the clock", "Some launchers and anti-cheat fail when the clock is off.", true, false, true, false),
        f("network", "Reset network stack", "Last resort for broken internet. Needs a restart.", true, false, true, true),
        f("trim", "Optimize drives (TRIM)", "Keeps SSDs fast. Can take a few minutes.", true, true, true, false),
        f("dism", "Clean up Windows components", "Removes superseded Windows Update files. Takes several minutes.", true, true, true, false),
        f("sfc", "Repair Windows system files", "Scans and repairs Windows. Can take 10-20 minutes.", true, true, true, false),
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
        Ok((code, out)) => fail(format!("Exited with code {code}. {}", out.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim())),
        Err(e) => fail(e),
    }
}

pub fn run_fix(id: &str) -> FixResult {
    let Some(fix) = fixes().into_iter().find(|f| f.id == id) else { return fail("Unknown fix") };
    if fix.admin && !core::is_admin() {
        return fail("Needs admin rights.");
    }
    let sys32 = core::windir().join("System32");
    let exe = |n: &str| sys32.join(n).display().to_string();
    match id {
        "dns" => check(run(&exe("ipconfig.exe"), &["/flushdns"]), "DNS cache flushed"),
        "ram" => match purge_standby() {
            Ok(freed) => ok(format!("Freed {} of standby memory", core::format_bytes(freed))),
            Err(e) => fail(e),
        },
        "shaders" => {
            let r = clean::clear_shader_cache();
            if r.failed.is_empty() { ok(r.message) } else { fail(r.message) }
        }
        "icons" => check(run(&exe("ie4uinit.exe"), &["-show"]), "Icon cache rebuilt"),
        "explorer" => {
            let _ = run(&exe("taskkill.exe"), &["/F", "/IM", "explorer.exe"]);
            std::thread::sleep(std::time::Duration::from_millis(800));
            match std::process::Command::new(core::windir().join("explorer.exe")).spawn() {
                Ok(_) => ok("Explorer restarted"),
                Err(e) => fail(format!("Couldn't start Explorer: {e}")),
            }
        }
        "time" => {
            let _ = run(&exe("net.exe"), &["start", "w32time"]);
            check(run(&exe("w32tm.exe"), &["/resync", "/force"]), "Clock synced")
        }
        "network" => {
            let a = run(&exe("netsh.exe"), &["winsock", "reset"]);
            let b = run(&exe("netsh.exe"), &["int", "ip", "reset"]);
            if matches!(a, Ok((0, _))) && b.is_ok() { ok("Network reset. Restart your PC to finish.") } else { check(a, "") }
        }
        "trim" => check(run(&exe("defrag.exe"), &["/C", "/O", "/H"]), "Drives optimized"),
        "dism" => check(run(&exe("Dism.exe"), &["/Online", "/Cleanup-Image", "/StartComponentCleanup"]), "Windows components cleaned up"),
        "sfc" => check(run(&exe("sfc.exe"), &["/scannow"]), "System file check finished"),
        _ => fail("Unknown fix"),
    }
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
        return Err("Windows didn't grant the memory privilege.".into());
    }
    let mut cmd: i32 = 4; // MemoryPurgeStandbyList
    let status = unsafe { NtSetSystemInformation(SYSTEM_MEMORY_LIST_INFORMATION, &mut cmd as *mut i32 as *mut _, 4) };
    if status != 0 {
        return Err(format!("Windows refused (status {status:#x})."));
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
        Tweak { id: "gamemode", name: "Windows Game Mode", detail: "Windows prioritizes your game and pauses updates while you play.", on: game_mode(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "nodvr", name: "Turn off background recording", detail: "Stops Xbox Game Bar from silently recording gameplay, which costs FPS.", on: dvr_off(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "highperf", name: "High performance power plan", detail: "Keeps your CPU at full speed. Uses more power on laptops.", on: high_perf(), recommended: true, admin: false, reboot: false, advanced: false },
        Tweak { id: "rawmouse", name: "Turn off mouse acceleration", detail: "Disables \"Enhance pointer precision\" for consistent aim.", on: mouse_raw(), recommended: true, admin: false, reboot: false, advanced: true },
        Tweak { id: "hags", name: "Hardware-accelerated GPU scheduling", detail: "Lets your GPU manage its own memory. Required for DLSS Frame Generation.", on: hags(), recommended: true, admin: true, reboot: true, advanced: true },
    ]
}

pub fn set_tweak(id: &str, on: bool) -> Result<(), String> {
    match id {
        "gamemode" => reg_set_dword(false, "Software\\Microsoft\\GameBar", "AutoGameModeEnabled", on as u32),
        "nodvr" => {
            reg_set_dword(false, "System\\GameConfigStore", "GameDVR_Enabled", (!on) as u32)?;
            reg_set_dword(false, "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "AppCaptureEnabled", (!on) as u32)
        }
        "highperf" => set_high_perf(on),
        "rawmouse" => set_mouse_raw(on),
        "hags" => {
            if !core::is_admin() {
                return Err("Needs admin rights.".into());
            }
            reg_set_dword(true, "SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "HwSchMode", if on { 2 } else { 1 })
        }
        _ => Err("Unknown tweak".into()),
    }
}

#[cfg(windows)]
fn reg_get_dword(machine: bool, path: &str, name: &str) -> Option<u32> {
    use winreg::enums::*;
    winreg::RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER }).open_subkey(path).ok()?.get_value(name).ok()
}
#[cfg(windows)]
fn reg_set_dword(machine: bool, path: &str, name: &str, v: u32) -> Result<(), String> {
    use winreg::enums::*;
    let (k, _) = winreg::RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
        .create_subkey(path)
        .map_err(|e| e.to_string())?;
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

fn find_guid(s: &str) -> Option<String> {
    let b = s.as_bytes();
    (0..b.len().saturating_sub(35)).find_map(|i| {
        let c = &s[i..i + 36];
        let ok = c.char_indices().all(|(j, ch)| if [8, 13, 18, 23].contains(&j) { ch == '-' } else { ch.is_ascii_hexdigit() });
        ok.then(|| c.to_lowercase())
    })
}

fn active_scheme() -> Option<String> {
    powercfg(&["/getactivescheme"]).ok().and_then(|(_, o)| find_guid(&o))
}

fn high_perf() -> bool {
    let a = active_scheme().unwrap_or_default();
    a == SCHEME_HIGH || a == SCHEME_ULTIMATE || prefs::get().prev_power_scheme.is_some() && a != SCHEME_BALANCED && is_boost_scheme(&a)
}

fn is_boost_scheme(guid: &str) -> bool {
    powercfg(&["/list"])
        .map(|(_, o)| o.lines().any(|l| l.to_lowercase().contains(guid) && (l.contains("High performance") || l.contains("Ultimate"))))
        .unwrap_or(false)
}

fn set_high_perf(on: bool) -> Result<(), String> {
    if on {
        let current = active_scheme();
        if let Some(c) = &current {
            if c != SCHEME_HIGH && c != SCHEME_ULTIMATE {
                let c = c.clone();
                prefs::update(|p| p.prev_power_scheme = Some(c));
            }
        }
        if matches!(powercfg(&["/setactive", SCHEME_HIGH]), Ok((0, _))) {
            return Ok(());
        }
        // Many laptops hide High performance; recreate it from the template.
        let (_, out) = powercfg(&["/duplicatescheme", SCHEME_HIGH])?;
        let guid = find_guid(&out).ok_or("This PC doesn't offer a High performance plan.")?;
        match powercfg(&["/setactive", &guid])? {
            (0, _) => Ok(()),
            (_, o) => Err(o.trim().to_string()),
        }
    } else {
        let target = prefs::get().prev_power_scheme.unwrap_or_else(|| SCHEME_BALANCED.into());
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
    if r != 0 { Ok(()) } else { Err("Windows rejected the mouse setting.".into()) }
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
        if NEVER_CLOSE.contains(&name.as_str()) {
            continue;
        }
        // Skip anything that ships with Windows, and processes we can't see the path of (services).
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

    // 1. Close the background apps the user picked (politely, like clicking X).
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
            label: "Closed background apps".into(),
            ok: closed > 0,
            detail: format!("{closed} of {} closed. Apps that only live in the tray may need closing by hand.", close.len()),
        });
    }
    // 2. Power, Game Mode, DNS, memory.
    if !high_perf() {
        let r = set_high_perf(true);
        steps.push(step("High performance power", r.map(|_| ok("Enabled")).unwrap_or_else(fail)));
    } else {
        steps.push(step("High performance power", ok("Already on")));
    }
    if !game_mode() {
        let r = set_tweak("gamemode", true);
        steps.push(step("Game Mode", r.map(|_| ok("Enabled")).unwrap_or_else(fail)));
    } else {
        steps.push(step("Game Mode", ok("Already on")));
    }
    steps.push(step("Flush DNS", run_fix("dns")));
    if core::is_admin() {
        steps.push(step("Free standby memory", run_fix("ram")));
    } else {
        steps.push(step("Free standby memory", fail("Skipped (needs admin)")));
    }
    std::thread::sleep(std::time::Duration::from_millis(1200));
    let ram_freed = available_memory().saturating_sub(before);
    prefs::update(|p| p.boost_active = true);
    history::add_boost();
    BoostReport { steps, ram_freed }
}

pub fn boost_restore() -> Result<(), String> {
    let r = if prefs::get().prev_power_scheme.is_some() { set_high_perf(false) } else { Ok(()) };
    prefs::update(|p| p.boost_active = false);
    r
}
