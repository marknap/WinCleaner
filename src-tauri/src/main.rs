#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analyze;
mod apps;
mod boost;
mod clean;
mod core;
mod files;
mod games;
mod history;
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
    prefs::save_from_ui(p)
}

#[tauri::command]
fn reveal(path: String) -> R<()> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err("It's not there anymore.".into());
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
        _ => return Err("Unknown settings page".into()),
    };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

#[tauri::command]
async fn clean_scan(app: AppHandle, only_auto: bool) -> R<Vec<clean::CleanGroup>> {
    core::begin_job();
    history::add_scan();
    blocking(move || clean::scan(Some(app), only_auto)).await
}

#[tauri::command]
async fn clean_run(targets: Vec<clean::CleanTarget>, tool: Option<String>) -> R<core::ActionResult> {
    blocking(move || clean::clean(targets, tool.as_deref().unwrap_or("Clean"))).await
}

#[tauri::command]
async fn large_scan(app: AppHandle) -> R<Vec<files::FileEntry>> {
    core::begin_job();
    blocking(move || files::large_scan(Some(app))).await
}

#[tauri::command]
async fn files_trash(paths: Vec<String>) -> R<core::ActionResult> {
    blocking(move || files::trash_files(paths, "Big files")).await
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
    blocking(move || apps::uninstall(&id)).await?
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
async fn game_leftovers_trash(paths: Vec<String>) -> R<core::ActionResult> {
    blocking(move || games::trash_leftovers(paths)).await
}

#[tauri::command]
fn game_action(launcher: String, id: String, action: String) -> R<()> {
    let url = games::action_url(&launcher, &id, &action)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| format!("Couldn't open the launcher: {e}"))
}

#[tauri::command]
async fn startup_list() -> R<Vec<startup::StartupItem>> {
    blocking(startup::list).await
}

#[tauri::command]
fn startup_set(id: String, enabled: bool) -> R<()> {
    startup::set_enabled(&id, enabled)
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
    blocking(move || boost::set_tweak(&id, on)).await?
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
    blocking(boost::boost_restore).await?
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
fn history_get() -> history::HistoryFile {
    history::load()
}

#[tauri::command]
async fn history_put_back(entry: String, index: usize) -> R<String> {
    blocking(move || history::put_back(&entry, index)).await?
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
    let dir = core::local().join("WinCleaner for Gamers");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("autoclean.log")) {
        let _ = writeln!(f, "[{}] {msg}", core::now_secs());
    }
}

fn main() {
    if std::env::args().any(|a| a == "--auto-clean") {
        headless_auto_clean();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open WinCleaner", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quickclean", "Quick Clean", true, None::<&str>)?;
            let boost = MenuItem::with_id(app, "boost", "Game Boost", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
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
            reveal,
            open_settings,
            clean_scan,
            clean_run,
            large_scan,
            files_trash,
            dup_default_roots,
            dup_scan,
            dup_trash,
            apps_list,
            app_uninstall,
            leftovers_trash,
            games_list,
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
            history_get,
            history_put_back,
            history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinCleaner");
}
