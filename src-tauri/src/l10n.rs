//! English / Dutch for backend messages. The UI has its own strings.

use std::sync::atomic::{AtomicBool, Ordering};

static NL: AtomicBool = AtomicBool::new(false);

/// `pref` is "en", "nl" or "auto" (follow the Windows display language).
pub fn set(pref: &str) {
    let nl = match pref {
        "nl" => true,
        "en" => false,
        _ => system_is_dutch(),
    };
    NL.store(nl, Ordering::Relaxed);
}

pub fn nl() -> bool {
    NL.load(Ordering::Relaxed)
}

pub fn code() -> &'static str {
    if nl() { "nl" } else { "en" }
}

pub fn tr(en: &'static str, nl: &'static str) -> &'static str {
    if self::nl() { nl } else { en }
}

#[cfg(windows)]
pub fn system_is_dutch() -> bool {
    // LANG_DUTCH primary language id.
    unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() & 0x3ff == 0x13 }
}
#[cfg(not(windows))]
pub fn system_is_dutch() -> bool {
    std::env::var("LANG").map(|l| l.starts_with("nl")).unwrap_or(false)
}

/// `trf!("Freed {}", "{} vrijgemaakt", x)`
#[macro_export]
macro_rules! trf {
    ($en:literal, $nl:literal $(, $a:expr)* $(,)?) => {
        if $crate::l10n::nl() { format!($nl $(, $a)*) } else { format!($en $(, $a)*) }
    };
}
