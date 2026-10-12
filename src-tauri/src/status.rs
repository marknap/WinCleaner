//! Live performance stats: CPU, RAM, GPU, network, ping, drives, battery, top processes.

use crate::core;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Networks, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub memory: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuExtra {
    pub name: String,
    pub temp: Option<f32>,
    pub vram_used: Option<u64>,
    pub vram_total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub cpu: f32,
    pub cores: Vec<f32>,
    pub cpu_name: String,
    pub mem_used: u64,
    pub mem_total: u64,
    pub gpu: Option<f32>,
    pub gpu_extra: Option<GpuExtra>,
    pub cpu_temp: Option<f32>,
    pub net_in: u64,
    pub net_out: u64,
    pub ping: Option<i64>,
    pub disks: Vec<crate::analyze::Drive>,
    pub battery: Option<(u8, bool)>,
    pub uptime: u64,
    pub procs: Vec<ProcInfo>,
}

struct Monitor {
    sys: System,
    nets: Networks,
    last: Instant,
    tick: u64,
    procs: Vec<ProcInfo>,
    gpu: Option<gpu::Pdh>,
}

static MON: Mutex<Option<Monitor>> = Mutex::new(None);
static PING: AtomicI64 = AtomicI64::new(-2);
static GPU_EXTRA: Mutex<Option<GpuExtra>> = Mutex::new(None);
static CPU_TEMP: Mutex<Option<f32>> = Mutex::new(None);
static LAST_REQ: AtomicU64 = AtomicU64::new(0);
static BG_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn sample() -> Sample {
    LAST_REQ.store(core::now_secs(), Ordering::Relaxed);
    ensure_background();
    let mut g = MON.lock().unwrap();
    let m = g.get_or_insert_with(|| {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        Monitor { sys, nets: Networks::new_with_refreshed_list(), last: Instant::now(), tick: 0, procs: vec![], gpu: gpu::Pdh::new() }
    });
    m.sys.refresh_cpu_usage();
    m.sys.refresh_memory();
    m.nets.refresh(true);
    let dt = m.last.elapsed().as_secs_f64().max(0.2);
    m.last = Instant::now();
    let (rx, tx) = m.nets.iter().fold((0u64, 0u64), |(r, t), (_, d)| (r + d.received(), t + d.transmitted()));

    if m.tick % 3 == 0 {
        m.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
        let cores = m.sys.cpus().len().max(1) as f32;
        let mut procs: Vec<ProcInfo> = m
            .sys
            .processes()
            .values()
            .filter(|p| p.pid().as_u32() != 0)
            .map(|p| ProcInfo { pid: p.pid().as_u32(), name: p.name().to_string_lossy().into_owned(), cpu: p.cpu_usage() / cores, memory: p.memory() })
            .collect();
        procs.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal).then(b.memory.cmp(&a.memory)));
        procs.truncate(40);
        m.procs = procs;
    }
    m.tick += 1;

    let ping = PING.load(Ordering::Relaxed);
    Sample {
        cpu: m.sys.global_cpu_usage(),
        cores: m.sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        cpu_name: m.sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        mem_used: m.sys.used_memory(),
        mem_total: m.sys.total_memory(),
        gpu: m.gpu.as_mut().and_then(|g| g.usage()),
        gpu_extra: GPU_EXTRA.lock().unwrap().clone(),
        cpu_temp: *CPU_TEMP.lock().unwrap(),
        net_in: (rx as f64 / dt) as u64,
        net_out: (tx as f64 / dt) as u64,
        ping: (ping >= -1).then_some(ping),
        disks: crate::analyze::drives(),
        battery: battery(),
        uptime: System::uptime(),
        procs: m.procs.clone(),
    }
}

/// Ping and nvidia-smi run on their own thread so sampling never blocks.
/// The thread stops by itself when the Performance screen isn't open.
fn ensure_background() {
    if BG_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let mut nvsmi = true;
        let mut acpi = core::is_admin();
        let mut n = 0u64;
        while core::now_secs().saturating_sub(LAST_REQ.load(Ordering::Relaxed)) < 10 {
            PING.store(ping_ms().unwrap_or(-1), Ordering::Relaxed);
            if nvsmi && n % 2 == 0 {
                match nvidia_smi() {
                    Some(x) => *GPU_EXTRA.lock().unwrap() = Some(x),
                    None => nvsmi = false,
                }
            }
            if acpi && n % 5 == 0 {
                match acpi_temp() {
                    Some(t) => *CPU_TEMP.lock().unwrap() = Some(t),
                    None => acpi = false,
                }
            }
            n += 1;
            std::thread::sleep(Duration::from_secs(2));
        }
        BG_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Hottest ACPI thermal zone in °C. Motherboard-reported and approximate; needs admin.
fn acpi_temp() -> Option<f32> {
    let ps = core::windir().join(r"System32\WindowsPowerShell\v1.0\powershell.exe").display().to_string();
    let (code, out) = core::run(
        &ps,
        &["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop).CurrentTemperature"],
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    out.lines()
        .filter_map(|l| l.trim().parse::<f32>().ok())
        .map(|tenth_kelvin| tenth_kelvin / 10.0 - 273.15)
        .filter(|c| (5.0..125.0).contains(c))
        .reduce(f32::max)
}

fn nvidia_smi() -> Option<GpuExtra> {
    let (code, out) = core::run(
        "nvidia-smi",
        &["--query-gpu=name,temperature.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    let line = out.lines().next()?;
    let f: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if f.len() < 4 {
        return None;
    }
    let mib = |s: &str| s.parse::<u64>().ok().map(|v| v * 1024 * 1024);
    Some(GpuExtra { name: f[0].into(), temp: f[1].parse().ok(), vram_used: mib(f[2]), vram_total: mib(f[3]) })
}

#[cfg(windows)]
fn ping_ms() -> Option<i64> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};
    unsafe {
        let h = IcmpCreateFile();
        if h.is_null() || h as isize == -1 {
            return None;
        }
        let data = [0u8; 32];
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + data.len() + 8];
        let dest = u32::from_ne_bytes([1, 1, 1, 1]);
        let n = IcmpSendEcho(h, dest, data.as_ptr() as *const _, data.len() as u16, std::ptr::null(), reply.as_mut_ptr() as *mut _, reply.len() as u32, 1000);
        IcmpCloseHandle(h);
        if n == 0 {
            return None;
        }
        let r = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
        (r.Status == 0).then_some(r.RoundTripTime as i64)
    }
}
#[cfg(not(windows))]
fn ping_ms() -> Option<i64> {
    None
}

#[cfg(windows)]
fn battery() -> Option<(u8, bool)> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    unsafe {
        let mut s: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut s) == 0 || s.BatteryFlag & 128 != 0 || s.BatteryLifePercent > 100 {
            return None;
        }
        Some((s.BatteryLifePercent, s.ACLineStatus == 1))
    }
}
#[cfg(not(windows))]
fn battery() -> Option<(u8, bool)> {
    None
}

#[cfg(windows)]
mod gpu {
    use windows_sys::Win32::System::Performance::*;

    /// Sum of 3D engine utilization across processes (what Task Manager shows).
    pub struct Pdh {
        query: isize,
        counter: isize,
    }
    unsafe impl Send for Pdh {}

    impl Pdh {
        pub fn new() -> Option<Self> {
            unsafe {
                let mut query = 0isize;
                if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
                    return None;
                }
                let mut counter = 0isize;
                let path = crate::core::wide("\\GPU Engine(*engtype_3D)\\Utilization Percentage");
                if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                    PdhCloseQuery(query);
                    return None;
                }
                PdhCollectQueryData(query);
                Some(Pdh { query, counter })
            }
        }

        pub fn usage(&mut self) -> Option<f32> {
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return None;
                }
                let mut size = 0u32;
                let mut count = 0u32;
                let r = PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut());
                if r != PDH_MORE_DATA || size == 0 {
                    return Some(0.0);
                }
                let mut buf = vec![0u64; (size as usize).div_ceil(8)];
                let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, items) != 0 {
                    return None;
                }
                let total: f64 = (0..count as usize).map(|i| (*items.add(i)).FmtValue.Anonymous.doubleValue).sum();
                Some(total.clamp(0.0, 100.0) as f32)
            }
        }
    }

    impl Drop for Pdh {
        fn drop(&mut self) {
            unsafe { PdhCloseQuery(self.query) };
        }
    }
}

#[cfg(not(windows))]
mod gpu {
    pub struct Pdh;
    impl Pdh {
        pub fn new() -> Option<Self> {
            None
        }
        pub fn usage(&mut self) -> Option<f32> {
            None
        }
    }
}
