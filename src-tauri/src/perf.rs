//! Latency to the cloud regions most online games are hosted in, and the FPS benchmark.

use crate::core;
use crate::history::{self, Counter};
use crate::l10n::{nl, tr};
use crate::{diag, prefs, trf};
use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPing {
    pub id: &'static str,
    pub name: &'static str,
    pub ms: Option<u64>,
}

/// (id, English, Dutch, AWS region). Many game servers run in these regions; their
/// public DynamoDB endpoints are a stable, always-on target.
const REGIONS: [(&str, &str, &str, &str); 10] = [
    ("euw", "EU West (Ireland)", "EU West (Ierland)", "eu-west-1"),
    ("euc", "EU Central (Frankfurt)", "EU Centraal (Frankfurt)", "eu-central-1"),
    ("uk", "UK (London)", "VK (Londen)", "eu-west-2"),
    ("eun", "EU North (Stockholm)", "EU Noord (Stockholm)", "eu-north-1"),
    ("use", "US East (Virginia)", "VS Oost (Virginia)", "us-east-1"),
    ("usw", "US West (Oregon)", "VS West (Oregon)", "us-west-2"),
    ("sa", "South America (São Paulo)", "Zuid-Amerika (São Paulo)", "sa-east-1"),
    ("asia", "Asia (Tokyo)", "Azië (Tokio)", "ap-northeast-1"),
    ("sea", "Southeast Asia (Singapore)", "Zuidoost-Azië (Singapore)", "ap-southeast-1"),
    ("oce", "Oceania (Sydney)", "Oceanië (Sydney)", "ap-southeast-2"),
];

/// TCP handshake time (one round trip), best of three. DNS is resolved beforehand.
fn tcp_rtt(host: &str) -> Option<u64> {
    let addr = (host, 443).to_socket_addrs().ok()?.next()?;
    (0..3)
        .filter_map(|_| {
            let t = Instant::now();
            TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).ok().map(|_| t.elapsed().as_millis() as u64)
        })
        .min()
}

pub fn ping_regions() -> Vec<RegionPing> {
    std::thread::scope(|s| {
        let handles: Vec<_> = REGIONS
            .iter()
            .map(|(id, en, nl_name, region)| {
                let name = if nl() { *nl_name } else { *en };
                s.spawn(move || RegionPing { id, name, ms: tcp_rtt(&format!("dynamodb.{region}.amazonaws.com")) })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    })
}

// ---------------------------------------------------------------------------
// FPS benchmark via Intel PresentMon (user-supplied, MIT licensed)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bench {
    pub process: String,
    pub frames: usize,
    pub seconds: u32,
    pub avg_fps: f64,
    pub low1: f64,
    pub low01: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
}

pub fn presentmon_path() -> Option<PathBuf> {
    if let Some(p) = prefs::get().presentmon_path {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut dirs = vec![core::app_dir()];
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        dirs.push(d);
    }
    dirs.into_iter().find_map(|d| {
        std::fs::read_dir(d).ok()?.flatten().map(|e| e.path()).find(|p| {
            let n = core::file_name(p).to_lowercase();
            n.starts_with("presentmon") && n.ends_with(".exe")
        })
    })
}

fn valid_process(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".exe") && n.len() < 100 && n.chars().all(|c| c.is_ascii_alphanumeric() || " ._-()".contains(c))
}

/// Frame times (ms) from PresentMon CSV. Supports v1 (`MsBetweenPresents`) and v2 (`FrameTime`).
fn parse_frametimes(csv: &str) -> Vec<f64> {
    let mut lines = csv.lines().filter(|l| !l.trim().is_empty());
    let Some(header) = lines.find(|l| l.contains(',')) else { return vec![] };
    let cols: Vec<String> = header.split(',').map(|c| c.trim().to_lowercase()).collect();
    let Some(idx) = ["msbetweenpresents", "frametime"].iter().find_map(|k| cols.iter().position(|c| c == k)) else { return vec![] };
    lines.filter_map(|l| l.split(',').nth(idx)?.trim().parse::<f64>().ok()).filter(|v| *v > 0.0 && v.is_finite()).collect()
}

fn stats(process: &str, seconds: u32, mut ft: Vec<f64>) -> Option<Bench> {
    if ft.len() < 10 {
        return None;
    }
    let n = ft.len();
    let avg_ms = ft.iter().sum::<f64>() / n as f64;
    ft.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pct = |p: f64| ft[((n as f64 * p).ceil() as usize).clamp(1, n) - 1];
    Some(Bench {
        process: process.into(),
        frames: n,
        seconds,
        avg_fps: 1000.0 / avg_ms,
        low1: 1000.0 / pct(0.99),
        low01: 1000.0 / pct(0.999),
        avg_ms,
        max_ms: ft[n - 1],
    })
}

pub fn benchmark(process: String, seconds: u32) -> Result<Bench, String> {
    if !valid_process(&process) || !core::running_processes().contains(&process.to_lowercase()) {
        return Err(tr("That game isn't running.", "Die game draait niet.").into());
    }
    let exe = presentmon_path().ok_or(tr("PresentMon wasn't found. Download it first.", "PresentMon niet gevonden. Download het eerst."))?;
    let seconds = seconds.clamp(5, 120);
    let secs = seconds.to_string();
    diag::info(format!("Benchmark {process} for {seconds}s"));
    let (code, out) = core::run(
        &exe.display().to_string(),
        &["--process_name", &process, "--output_stdout", "--stop_existing_session", "--session_name", "WinCleanerBench", "--terminate_after_timed", "--timed", &secs],
    )?;
    let frames = parse_frametimes(&out);
    let r = stats(&process, seconds, frames).ok_or_else(|| {
        diag::warn(format!("PresentMon exit {code}: {}", out.lines().take(5).collect::<Vec<_>>().join(" | ")));
        if core::is_admin() {
            trf!("No frames captured from {}. Is the game in focus and rendering?", "Geen frames opgevangen van {}. Staat de game op de voorgrond en rendert hij?", process)
        } else {
            tr("No frames captured. PresentMon usually needs admin rights.", "Geen frames opgevangen. PresentMon heeft meestal beheerdersrechten nodig.").to_string()
        }
    })?;
    history::bump(Counter::Benchmark);
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v1_and_v2() {
        let v1 = "Application,ProcessID,MsBetweenPresents,Dropped\ngame.exe,1,16.6,0\ngame.exe,1,16.8,0\n";
        assert_eq!(parse_frametimes(v1), vec![16.6, 16.8]);
        let v2 = "Application,ProcessID,FrameTime,CPUBusy\ngame.exe,1,8.3,2\ngame.exe,1,NA,2\n";
        assert_eq!(parse_frametimes(v2), vec![8.3]);
        assert!(parse_frametimes("garbage").is_empty());
    }

    #[test]
    fn computes_lows() {
        let mut ft = vec![10.0; 990];
        ft.extend(vec![50.0; 10]);
        let b = stats("g.exe", 10, ft).unwrap();
        assert!((b.avg_fps - 1000.0 / 10.4).abs() < 0.01);
        assert!((b.low1 - 100.0).abs() < 0.01);
        assert!((b.low01 - 20.0).abs() < 0.01);
    }

    #[test]
    fn process_names_are_validated() {
        assert!(valid_process("eldenring.exe"));
        assert!(valid_process("Cyberpunk2077.exe"));
        assert!(!valid_process("x.exe --output C:\\evil"));
        assert!(!valid_process("notepad"));
    }
}
