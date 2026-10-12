//! Rolling log file and "Export diagnostics".

use crate::{core, history, l10n, prefs};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_LOG: u64 = 1024 * 1024;
static LOCK: Mutex<()> = Mutex::new(());

fn log_dir() -> PathBuf {
    let d = core::local().join("WinCleaner for Gamers").join("logs");
    let _ = fs::create_dir_all(&d);
    d
}

pub fn log_file() -> PathBuf {
    log_dir().join("wincleaner.log")
}

/// UTC "YYYY-MM-DD HH:MM:SS" without pulling in a date crate.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

pub fn write(level: &str, msg: &str) {
    let _g = LOCK.lock();
    let path = log_file();
    if fs::metadata(&path).map(|m| m.len() > MAX_LOG).unwrap_or(false) {
        let _ = fs::rename(&path, path.with_extension("old.log"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} [{level}] {msg}", timestamp(core::now_secs()));
    }
}

pub fn info(msg: impl AsRef<str>) {
    write("INFO", msg.as_ref());
}
pub fn warn(msg: impl AsRef<str>) {
    write("WARN", msg.as_ref());
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|p| write("PANIC", &p.to_string())));
}

/// Plain-text report for bug reports. Contains no file contents, only settings, counts and the log.
pub fn export(path: String, version: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")) {
        return Err(l10n::tr("Choose a .txt file.", "Kies een .txt-bestand.").into());
    }
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    let h = history::load();
    let log = fs::read_to_string(log_file()).unwrap_or_default();
    let tail: Vec<&str> = log.lines().rev().take(500).collect();
    let mut out = String::new();
    out.push_str("WinCleaner for Gamers diagnostics\n=================================\n");
    out.push_str(&format!("Created:   {} UTC\n", timestamp(core::now_secs())));
    out.push_str(&format!("Version:   {version}\n"));
    out.push_str(&format!("Windows:   {}\n", sysinfo::System::long_os_version().unwrap_or_default()));
    out.push_str(&format!("CPU:       {}\n", sys.cpus().first().map(|c| c.brand().trim()).unwrap_or("")));
    out.push_str(&format!("RAM:       {}\n", core::format_bytes(sys.total_memory())));
    out.push_str(&format!("Admin:     {}\n", core::is_admin()));
    out.push_str(&format!("Language:  {}\n", l10n::code()));
    out.push_str(&format!("History:   {} entries, {} freed, {} boosts, {} scans\n\n", h.entries.len(), core::format_bytes(h.lifetime_freed), h.boosts, h.scans));
    out.push_str("Settings\n--------\n");
    out.push_str(&serde_json::to_string_pretty(&prefs::get()).unwrap_or_default());
    out.push_str("\n\nLog (newest first)\n------------------\n");
    for l in tail {
        out.push_str(l);
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn timestamps() {
        assert_eq!(super::timestamp(0), "1970-01-01 00:00:00");
        assert_eq!(super::timestamp(1_700_000_000), "2023-11-14 22:13:20");
        assert_eq!(super::timestamp(951_782_400), "2000-02-29 00:00:00");
    }
}
