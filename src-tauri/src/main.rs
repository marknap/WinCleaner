#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analyze;
mod apps;
mod boost;
mod clean;
mod core;
mod diag;
mod files;
mod games;
mod history;
mod l10n;
mod perf;
mod prefs;
mod startup;
mod status;

use serde::Serialize;
use std::io::Write;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

type R<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

/// Log failed commands so "Export diagnostics" has something useful.
fn logged<T>(cmd: &str, r: R<T>) -> R<T> {
    if let Err(e) = &r {
        diag::warn(format!("{cmd}: {e}"));
    }
    r
}

// ---------------------------------------------------------------------------
// App-level commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SysInfo {
    is_admin: bool,
    version: String,
    os: String,
    host: String,
    cpu: String,
    ram: u64,
    language: String,
    presentmon: bool,
}

#[tauri::command]
fn system_info(app: AppHandle) -> SysInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    SysInfo {
        is_admin: core::is_admin(),
        version: app.package_info().version.to_string(),
        os: sysinfo::System::long_os_version().unwrap_or_else(|| "Windows".into()),
        host: sysinfo::System::host_name().unwrap_or_default(),
        cpu: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        ram: sys.total_memory(),
        language: l10n::code().into(),
        presentmon: perf::presentmon_path().is_some(),
    }
}

#[tauri::command]
fn relaunch_admin(app: AppHandle) -> R<()> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    core::shell_execute("runas", &exe.display().to_string(), "", false)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn cancel_job() {
    core::cancel_job();
}

#[tauri::command]
fn get_prefs() -> prefs::Prefs {
    prefs::get()
}

#[tauri::command]
fn set_prefs(p: prefs::Prefs) -> R<prefs::Prefs> {
    logged("set_prefs", prefs::save_from_ui(p))
}

#[tauri::command]
fn prefs_export(path: String) -> R<()> {
    logged("prefs_export", prefs::export(path))
}

#[tauri::command]
fn prefs_import(path: String) -> R<prefs::Prefs> {
    logged("prefs_import", prefs::import(path))
}

#[tauri::command]
fn diagnostics_export(app: AppHandle, path: String) -> R<()> {
    logged("diagnostics_export", diag::export(path, &app.package_info().version.to_string()))
}

#[tauri::command]
async fn restore_point_create() -> R<String> {
    logged("restore_point", blocking(|| core::restore_point(true)).await?)
}

#[tauri::command]
fn reveal(path: String) -> R<()> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(l10n::tr("It's not there anymore.", "Het staat er niet meer.").into());
    }
    tauri_plugin_opener::reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_settings(page: String) -> R<()> {
    let url = match page.as_str() {
        "startupapps" => "ms-settings:startupapps",
        "gamemode" => "ms-settings:gaming-gamemode",
        "graphics" => "ms-settings:display-advancedgraphics",
        "storage" => "ms-settings:storagesense",
        "power" => "ms-settings:powersleep",
        "apps" => "ms-settings:appsfeatures",
        "recovery" => "ms-settings:recovery",
        "presentmon" => "https://github.com/GameTechDev/PresentMon/releases/latest",
        "releases" => "https://github.com/marknap/WinCleaner/releases",
        _ => return Err("Unknown page".into()),
    };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

#[tauri::command]
async fn clean_scan(app: AppHandle, only_auto: bool) -> R<Vec<clean::CleanGroup>> {
    core::begin_job();
    history::bump(history::Counter::Scan);
    blocking(move || clean::scan(Some(app), only_auto)).await
}

#[tauri::command]
async fn clean_run(targets: Vec<clean::CleanTarget>, tool: Option<String>) -> R<core::ActionResult> {
    let tool = match tool.as_deref() {
        Some(t @ ("smart" | "quick")) => t.to_string(),
        _ => "clean".to_string(),
    };
    blocking(move || clean::clean(targets, &tool)).await
}

#[tauri::command]
async fn large_scan(app: AppHandle) -> R<Vec<files::FileEntry>> {
    core::begin_job();
    blocking(move || files::large_scan(Some(app))).await
}

#[tauri::command]
async fn clips_summary() -> R<files::ClipsSummary> {
    blocking(files::clips_summary).await
}

#[tauri::command]
async fn files_trash(paths: Vec<String>) -> R<core::ActionResult> {
    blocking(move || files::trash_files(paths, "bigfiles")).await
}

#[tauri::command]
fn dup_default_roots() -> Vec<String> {
    files::default_dup_roots()
}

#[tauri::command]
async fn dup_scan(app: AppHandle, roots: Vec<String>) -> R<Vec<files::DupGroup>> {
    core::begin_job();
    blocking(move || files::dup_scan(Some(app), roots)).await
}

#[tauri::command]
async fn dup_trash(groups: Vec<Vec<String>>, selected: Vec<String>) -> R<core::ActionResult> {
    blocking(move || files::dup_trash(groups, selected)).await
}

#[tauri::command]
async fn apps_list() -> R<Vec<apps::InstalledApp>> {
    blocking(apps::list).await
}

#[tauri::command]
async fn app_uninstall(id: String) -> R<apps::UninstallResult> {
    logged("app_uninstall", blocking(move || apps::uninstall(&id)).await?)
}

#[tauri::command]
async fn app_leftovers(id: String) -> R<Vec<apps::Leftover>> {
    blocking(move || apps::preview_leftovers(&id)).await?
}

#[tauri::command]
fn recent_uninstalls() -> Vec<prefs::RecentUninstall> {
    prefs::get().recent_uninstalls
}

#[tauri::command]
async fn recent_leftovers(name: String) -> R<Vec<apps::Leftover>> {
    blocking(move || apps::recent_leftovers(&name)).await?
}

#[tauri::command]
async fn leftovers_trash(paths: Vec<String>) -> R<core::ActionResult> {
    blocking(move || apps::trash_leftovers(paths)).await
}

#[tauri::command]
async fn games_list() -> R<games::Library> {
    blocking(games::library).await
}

#[tauri::command]
async fn game_art(appid: String) -> R<Option<String>> {
    blocking(move || games::steam_art(&appid)).await
}

#[tauri::command]
async fn game_leftovers_trash(paths: Vec<String>) -> R<core::ActionResult> {
    blocking(move || games::trash_leftovers(paths)).await
}

#[tauri::command]
fn game_action(launcher: String, id: String, action: String) -> R<()> {
    let url = games::action_url(&launcher, &id, &action)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| crate::trf!("Couldn't open the launcher: {}", "Kon de launcher niet openen: {}", e))
}

#[tauri::command]
async fn startup_list() -> R<Vec<startup::StartupItem>> {
    blocking(startup::list).await
}

#[tauri::command]
fn startup_set(id: String, enabled: bool) -> R<()> {
    let r = logged("startup_set", startup::set_enabled(&id, enabled));
    if r.is_ok() && !enabled {
        history::bump(history::Counter::StartupDisabled);
    }
    r
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoostState {
    fixes: Vec<boost::Fix>,
    tweaks: Vec<boost::Tweak>,
    boost_active: bool,
}

#[tauri::command]
async fn boost_state() -> R<BoostState> {
    blocking(|| BoostState { fixes: boost::fixes(), tweaks: boost::tweaks(), boost_active: prefs::get().boost_active }).await
}

#[tauri::command]
async fn boost_fix(id: String) -> R<boost::FixResult> {
    blocking(move || boost::run_fix(&id)).await
}

#[tauri::command]
async fn tweak_set(id: String, on: bool) -> R<()> {
    logged("tweak_set", blocking(move || boost::set_tweak(&id, on)).await?)
}

#[tauri::command]
async fn boost_candidates() -> R<Vec<boost::Candidate>> {
    blocking(boost::candidates).await
}

#[tauri::command]
async fn game_boost(close: Vec<String>) -> R<boost::BoostReport> {
    blocking(move || boost::game_boost(close)).await
}

#[tauri::command]
async fn boost_restore() -> R<()> {
    logged("boost_restore", blocking(boost::boost_restore).await?)
}

#[tauri::command]
fn drives() -> Vec<analyze::Drive> {
    analyze::drives()
}

#[tauri::command]
async fn analyze_scan(app: AppHandle, root: String) -> R<analyze::NodeView> {
    core::begin_job();
    blocking(move || analyze::scan(Some(app), root)).await?
}

#[tauri::command]
fn analyze_open(path: String) -> R<analyze::NodeView> {
    analyze::open(path)
}

#[tauri::command]
async fn analyze_trash(path: String) -> R<core::ActionResult> {
    blocking(move || analyze::trash(path)).await?
}

#[tauri::command]
async fn status_sample() -> R<status::Sample> {
    blocking(status::sample).await
}

#[tauri::command]
async fn ping_regions() -> R<Vec<perf::RegionPing>> {
    blocking(perf::ping_regions).await
}

#[tauri::command]
async fn fps_benchmark(process: String, seconds: u32) -> R<perf::Bench> {
    logged("fps_benchmark", blocking(move || perf::benchmark(process, seconds)).await?)
}

#[tauri::command]
fn history_get() -> history::HistoryFile {
    history::load()
}

#[tauri::command]
async fn history_put_back(entry: String, index: usize) -> R<String> {
    logged("history_put_back", blocking(move || history::put_back(&entry, index)).await?)
}

#[tauri::command]
fn history_clear() {
    history::clear()
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn headless_auto_clean() {
    let msg = clean::auto_clean();
    diag::info(format!("Scheduled clean: {msg}"));
    let dir = core::local().join("WinCleaner for Gamers");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("autoclean.log")) {
        let _ = writeln!(f, "[{}] {msg}", diag::timestamp(core::now_secs()));
    }
}

/// Live CPU / RAM / system-drive stats in the tray tooltip.
fn tray_stats(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = sysinfo::System::new();
        let drive = core::system_drive();
        loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            std::thread::sleep(std::time::Duration::from_secs(3));
            sys.refresh_cpu_usage();
            let ram = sys.used_memory() as f64 / sys.total_memory().max(1) as f64 * 100.0;
            let free = sysinfo::Disks::new_with_refreshed_list()
                .list()
                .iter()
                .find(|d| core::same_path(d.mount_point(), &drive))
                .map(|d| core::format_bytes(d.available_space()))
                .unwrap_or_default();
            let tip = crate::trf!(
                "WinCleaner for Gamers\nCPU {:.0}%  ·  RAM {:.0}%\n{} free on {}",
                "WinCleaner for Gamers\nCPU {:.0}%  ·  RAM {:.0}%\n{} vrij op {}",
                sys.global_cpu_usage(),
                ram,
                free,
                drive.display()
            );
            match app.tray_by_id("main") {
                Some(t) => {
                    let _ = t.set_tooltip(Some(tip));
                }
                None => break,
            }
        }
    });
}

fn main() {
    diag::install_panic_hook();
    l10n::set(&prefs::get().language);

    if std::env::args().any(|a| a == "--auto-clean") {
        headless_auto_clean();
        return;
    }
    diag::info(format!("Started v{} (admin: {})", env!("CARGO_PKG_VERSION"), core::is_admin()));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let t = l10n::tr;
            let open = MenuItem::with_id(app, "open", t("Open WinCleaner", "WinCleaner openen"), true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quickclean", t("Quick Clean", "Snel opschonen"), true, None::<&str>)?;
            let boost = MenuItem::with_id(app, "boost", "Game Boost", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", t("Quit", "Afsluiten"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick, &boost, &sep, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("WinCleaner for Gamers")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quickclean" | "boost" => {
                        show_main(app);
                        let _ = app.emit("tray", e.id.as_ref().to_string());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            tray_stats(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if prefs::get().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            relaunch_admin,
            cancel_job,
            get_prefs,
            set_prefs,
            prefs_export,
            prefs_import,
            diagnostics_export,
            restore_point_create,
            reveal,
            open_settings,
            clean_scan,
            clean_run,
            large_scan,
            clips_summary,
            files_trash,
            dup_default_roots,
            dup_scan,
            dup_trash,
            apps_list,
            app_uninstall,
            app_leftovers,
            recent_uninstalls,
            recent_leftovers,
            leftovers_trash,
            games_list,
            game_art,
            game_leftovers_trash,
            game_action,
            startup_list,
            startup_set,
            boost_state,
            boost_fix,
            tweak_set,
            boost_candidates,
            game_boost,
            boost_restore,
            drives,
            analyze_scan,
            analyze_open,
            analyze_trash,
            status_sample,
            ping_regions,
            fps_benchmark,
            history_get,
            history_put_back,
            history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinCleaner");
}
