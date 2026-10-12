<p align="center">
  <img src="app-icon.svg" width="96" alt="WinCleaner for Gamers logo" />
</p>

<h1 align="center">WinCleaner for Gamers</h1>

<p align="center">
  <b>Clean your PC, boost your games, keep your rig fast.</b><br/>
  One click for most people, plenty of control for the people who want it.
</p>

---

## Contents

- [What is this?](#what-is-this)
- [Install](#install)
- [Your first 2 minutes](#your-first-2-minutes)
- [What every screen does](#what-every-screen-does)
- [Is it safe?](#is-it-safe)
- [FAQ](#faq)
- [Under the hood (for the tech-savvy)](#under-the-hood-for-the-tech-savvy)
  - [What exactly gets cleaned](#what-exactly-gets-cleaned)
  - [What Game Boost and the tweaks change](#what-game-boost-and-the-tweaks-change)
  - [Startup apps](#startup-apps)
  - [Game library detection](#game-library-detection)
  - [Safety model](#safety-model)
  - [Where your data lives](#where-your-data-lives)
  - [Scheduled cleaning](#scheduled-cleaning)
  - [Health grade and XP](#health-grade-and-xp)
- [Build it yourself](#build-it-yourself)
- [Project layout](#project-layout)
- [Removing WinCleaner](#removing-wincleaner)

---

## What is this?

WinCleaner for Gamers is a free app for Windows 10 and 11 that:

- **Clears junk.** Temp files, launcher caches, crash dumps, old GPU driver installers and more. It often frees several gigabytes.
- **Boosts your games.** One button switches your PC to full performance before you play.
- **Shows where your space went.** See which games are eating your SSD and which ones you haven't touched in months.
- **Speeds up boot.** Tells you which startup apps you can safely turn off, in plain English.
- **Shows live stats.** CPU, GPU, RAM, temps and ping while you play.

Your game saves are never touched, and anything bigger than a cache goes to the Recycle Bin so you can undo it.

---

## Install

1. Download the installer: `WinCleaner for Gamers_x.y.z_x64-setup.exe`.
2. Double-click it and follow the steps. You don't need admin rights to install just for yourself.
3. **If Windows shows "Windows protected your PC":** click **More info**, then **Run anyway**. You see this because the app isn't code-signed (signing certificates cost money). It isn't a virus warning.

Requirements: Windows 10 or 11, 64-bit. Nothing else to install.

---

## Your first 2 minutes

1. Open WinCleaner and hit the big **SCAN** button.
2. The scan checks four things: junk files, your game library, startup apps and big files.
3. You get a **health grade from S to D** and a few cards showing what it found.
4. Click **Clean** to remove the safe junk. Done.
5. Before a gaming session, open **Game Boost** and press **BOOST**.

That's all most people ever need. Everything else is optional.

> **Tip:** Click **Restart as admin** in the blue banner to unlock everything. It adds system-level cleanup (Windows Update leftovers, system crash dumps) and the "free standby RAM" boost.

---

## What every screen does

### The main screens

| Screen | In one sentence |
|---|---|
| **Home** | One-click checkup with a health grade, your rank, and shortcuts to everything. |
| **Clean** | Pick what junk to clear. The safe stuff is already ticked for you. |
| **Game Boost** | Max performance in one click, plus quick fixes for common gaming problems. |
| **My Games** | All your Steam, Epic and GOG games: size, drive, and when you last played. |
| **Startup** | Turn off apps that launch with Windows and slow down your boot. |
| **Performance** | Live CPU, GPU, RAM, ping, network and drive stats. |

### Clean

Junk is grouped into **Gaming**, **Windows**, **Browsers** and **Developer**. Each group shows how much space it uses. Click a category to see the actual files.

- Ticked = safe to remove.
- **Optional** = worth knowing about, but left unticked (like the GPU shader cache).
- **App running** = the app is open right now, so it's unticked to be safe. Close the app and rescan.
- **Admin** = needs admin rights. Use **Restart as admin**.

### Game Boost

**The BOOST button** does all of this at once:

- Politely closes background apps you picked (OneDrive, Teams and similar). They close like you clicked X, so you'll still get "save your work?" prompts.
- Switches to the **High performance** power plan.
- Makes sure Windows **Game Mode** is on.
- Flushes your **DNS cache**.
- Frees **standby RAM** (admin only).

When you're done playing, click **Restore normal mode** to switch back to your old power plan.

**Quick fixes** are one-click repairs:

| Fix | Use it when... |
|---|---|
| Flush DNS cache | You get "can't connect to server" errors. |
| Free standby memory | You get stutter on a PC with 8–16 GB of RAM. |
| Reset GPU shader cache | You see stutter or graphical glitches after a driver update. |
| Rebuild icon cache | Desktop or taskbar icons are blank or wrong. |
| Restart Explorer | The taskbar or Start menu is frozen. |

**Gaming settings** are switches you can flip back anytime: Game Mode, turning off background recording, and the High performance power plan. More settings sit under **Advanced**.

### My Games

- **Dusty** games haven't been played in 90+ days. They're good candidates to uninstall if you need space.
- **Leftovers from uninstalled games:** Steam often leaves folders behind after an uninstall, and they can be gigabytes. WinCleaner finds them for you. Check them for mods or old saves first. Anything you remove goes to the Recycle Bin.
- Each game card has buttons to **play**, **verify/repair files**, **open the game folder** or **uninstall** it through its launcher.

### Startup

Apps are sorted into three groups:

- **Safe to disable:** launchers and chat apps that open fine when you need them.
- **Your call:** sync apps, Discord, and anything we don't recognise.
- **Keep these on:** Windows Security, audio and GPU drivers, RGB and mouse software.

**Disable all** turns off every app in the "Safe to disable" list at once. Disabling doesn't uninstall anything, and you can turn an app back on anytime.

### Pro tools (in the sidebar, click to expand)

| Tool | What it's for |
|---|---|
| **Big Files** | Files over 500 MB, files you haven't touched in 6+ months, or old installers sitting in Downloads. |
| **Duplicates** | Identical files, compared byte for byte. The newest copy is always kept. |
| **Uninstaller** | Runs a program's own uninstaller, then finds the folders it left behind. |
| **Disk Map** | A visual map of a drive: bigger block = bigger file. Click folders to dive in. |
| **History** | Everything WinCleaner removed. Use **Put back** to restore items from the Recycle Bin. |

### Your rank

Freeing space, boosting and scanning earn XP. Climb from **Rookie** through Bronze, Silver, Gold, Platinum and Diamond up to **Legend**.

---

## Is it safe?

Short answer: yes, it was designed to be careful.

- **Your saves are off-limits.** `Saved Games`, `Documents\My Games` and `AppData` are never offered for deletion by the file tools.
- **Undo is built in.** Big files, duplicates, leftovers and Disk Map deletions go to the **Recycle Bin**. You can put them back from **History**.
- **Caches are the only thing deleted for good**, because they rebuild themselves. If you'd rather recycle those too, turn on **Send cleaned caches to the Recycle Bin** in Settings.
- **Running apps are respected.** A running app's cache is left unticked, and files in use are skipped.
- **Fresh files are kept.** Temp files used in the last 24 hours are never removed.
- **"Never touch" list.** Add any file or folder in Settings and WinCleaner will never touch it.
- **Every change can be undone.** Startup changes and gaming settings can all be switched back.

---

## FAQ

**Will this delete my game saves?**
No. Save locations are protected. See [Safety model](#safety-model) for the exact rules.

**Why did my space not go down after cleaning?**
You probably have **Send cleaned caches to the Recycle Bin** turned on. Empty the Recycle Bin, or turn that setting off.

**Some files were "skipped because they're in use".**
That's normal. Something running is holding them open. Close the app (or restart your PC) and clean again.

**Clearing the shader cache made my game stutter.**
That's expected for the first few minutes, or the first match. The game rebuilds its shaders and the stutter stops. Clear this cache when something looks broken, not as a routine clean.

**Does Game Boost give me more FPS?**
It removes things that commonly steal performance: power saving, background recording, background apps and low free RAM. On a well-tuned PC the gain may be small. On a laptop or a cluttered PC it can be noticeable. It doesn't overclock anything.

**Do I need to run it as admin?**
No. It works fine without admin. Admin unlocks a few extra items, and they're clearly marked with a shield.

**Does it send my data anywhere?**
No. There's no account, telemetry or tracking. The only internet requests are:
- loading Steam game cover images from Steam's image servers
- the ping test to `1.1.1.1` on the Performance screen

**Why does Windows warn me when I install it?**
The installer isn't code-signed. See [Install](#install).

---

## Under the hood (for the tech-savvy)

WinCleaner is a [Tauri 2](https://tauri.app) app: a Rust backend with a React + TypeScript UI rendered by WebView2. All system access happens in Rust. The UI can only call a fixed set of commands.

### What exactly gets cleaned

"Items" are the **direct children** of each folder listed below. Paths are relative to `%LOCALAPPDATA%` unless shown otherwise. `*` matches any profile folder; `webcache*` matches folders starting with `webcache`.

| Category | Paths | Default | Notes |
|---|---|---|---|
| Temporary files | `%TEMP%` | ✓ | Skips anything modified in the last 24 h |
| Windows temp files | `%SystemRoot%\Temp` | ✓ | Admin. Skips anything modified in the last 24 h |
| App crash reports | `CrashDumps`, `Microsoft\Windows\WER\ReportArchive`, `…\ReportQueue` | ✓ | |
| Thumbnail & icon cache | `Microsoft\Windows\Explorer\thumbcache_*`, `iconcache_*` | ✓ | Files only. Locked ones are skipped |
| System crash dumps | `%SystemRoot%\Minidump`, `%SystemRoot%\LiveKernelReports`, `%ProgramData%\Microsoft\Windows\WER\Report{Archive,Queue}` | ✓ | Admin |
| Windows Update downloads | `%SystemRoot%\SoftwareDistribution\Download` | ✓ | Admin |
| Delivery Optimization cache | `%SystemRoot%\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache` | ✓ | Admin |
| Recycle Bin | All drives (`SHEmptyRecycleBinW`) | ✗ | Unticked so Put back keeps working |
| Steam web cache | `Steam\htmlcache`, `<Steam>\appcache\httpcache` | ✓ | Skipped while Steam is running |
| Steam logs & crash dumps | `<Steam>\logs`, `<Steam>\dumps` | ✓ | |
| Epic Games Launcher cache | `EpicGamesLauncher\Saved\webcache*`, `…\Saved\Logs` | ✓ | |
| Battle.net cache | `Battle.net\Cache`, `Battle.net\BrowserCaches` | ✓ | |
| GOG Galaxy cache | `%ProgramData%\GOG.com\Galaxy\webcache` | ✓ | |
| Discord cache | `%APPDATA%\discord\{Cache, Code Cache, GPUCache}`, `%APPDATA%\discordptb\Cache`, `%APPDATA%\discordcanary\Cache` | ✓ | |
| Old GPU driver installers | `C:\NVIDIA`, `C:\AMD` | ✓ | Extracted setup files |
| GPU shader cache | `NVIDIA\DXCache`, `NVIDIA\GLCache`, `NVIDIA Corporation\NV_Cache`, `D3DSCache`, `AMD\{DxCache,DxcCache,VkCache,GLCache}`, `Intel\ShaderCache`, `%USERPROFILE%\AppData\LocalLow\NVIDIA\PerDriverVersion\{DXCache,GLCache}` | ✗ | Rebuilt on next launch |
| Steam shader pre-caches | `<each Steam library>\steamapps\shadercache` | ✗ | |
| Chrome / Edge / Brave | `…\User Data\*\{Cache, Code Cache, GPUCache, Service Worker\CacheStorage}`, `ShaderCache`, `GrShaderCache` | ✓ | Skipped while the browser runs |
| Opera / Opera GX | `Opera Software\Opera {GX ,}Stable\Cache`, `Opera Software\Opera GX Stable\Code Cache` | ✓ | |
| Firefox | `Mozilla\Firefox\Profiles\*\cache2` | ✓ | |
| Package manager caches | `npm-cache`, `pip\cache`, `Yarn\Cache`, `NuGet\v3-cache`, `go-build` | ✓ | |
| Stale node_modules | Top-level `node_modules` under `~\Projects`, `Code`, `source`, `repos`, `GitHub`, `Documents`… | ✗ | Only projects untouched for 90+ days |

**Quick Clean** (from the tray) and **scheduled cleaning** only use the categories marked "auto-clean": temp files, crash reports, launcher, browser and package caches. They never touch the Recycle Bin, Windows Update files, driver installers or shader caches.

### What Game Boost and the tweaks change

| Item | Mechanism | How it's undone |
|---|---|---|
| Game Mode | `HKCU\Software\Microsoft\GameBar\AutoGameModeEnabled` = 1 | Set back to 0 |
| Background recording off | `HKCU\System\GameConfigStore\GameDVR_Enabled` = 0, `HKCU\…\CurrentVersion\GameDVR\AppCaptureEnabled` = 0 | Set back to 1 |
| High performance power | `powercfg /setactive 8c5e7fda-…` (recreated with `/duplicatescheme` if hidden). The previous plan's GUID is saved | Restores the saved plan, or Balanced |
| Mouse acceleration off | `SystemParametersInfo(SPI_SETMOUSE, [0,0,0])` | `[6,10,1]` (Windows default) |
| HW GPU scheduling | `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode` = 2 | Set to 1. Admin, needs a reboot |
| Free standby memory | `NtSetSystemInformation(SystemMemoryListInformation, MemoryPurgeStandbyList)` with `SeProfileSingleProcessPrivilege` | Not needed (it's a cache) |
| Flush DNS | `ipconfig /flushdns` | Not needed |
| Rebuild icon cache | `ie4uinit.exe -show` | Not needed |
| Sync clock | `w32tm /resync /force` | Admin |
| Reset network stack | `netsh winsock reset` + `netsh int ip reset` | Admin, needs a reboot |
| Optimize drives | `defrag /C /O /H` | Admin |
| Clean up components | `Dism /Online /Cleanup-Image /StartComponentCleanup` | Admin |
| Repair system files | `sfc /scannow` | Admin |

**Closing background apps:**
- Apps are closed with `taskkill /IM <name>` without `/F`, so each one gets a normal close request.
- Only processes outside `%SystemRoot%` that use 40 MB+ of RAM (or are on the suggested list) are offered.
- A hard-coded never-close list covers Windows core processes, GPU drivers, anti-cheat, launchers, Discord, OBS and peripheral software.

### Startup apps

Sources:
- `HKCU\…\Run`
- `HKLM\…\Run`
- `HKLM\…\WOW6432Node\…\Run`
- the user Startup folder
- the common Startup folder

Enabling and disabling uses the same mechanism as Task Manager: a 12-byte value in `…\Explorer\StartupApproved\{Run, Run32, StartupFolder}`.
- First byte `0x02` = enabled.
- First byte `0x03` = disabled, followed by a FILETIME.

The original Run entry and shortcut are never modified. Entries for all users (HKLM) need admin.

### Game library detection

| Launcher | Source |
|---|---|
| Steam | Install path from `HKCU\Software\Valve\Steam\SteamPath`. Libraries from `steamapps\libraryfolders.vdf`. Games from `appmanifest_*.acf` (name, `SizeOnDisk`, `LastPlayed`) |
| Epic | `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON) |
| GOG | `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\*`. Size is measured from the install folder |

**Leftovers** are:
- folders in `steamapps\common` that no manifest references
- folders in `steamapps\downloading` for app IDs that no longer exist
- anything in `steamapps\temp`

Download and temp leftovers are locked while Steam is running.

**Launcher actions** use the launchers' own links (`steam://rungameid/<id>`, `steam://validate/<id>`, `steam://uninstall/<id>`, `com.epicgames.launcher://…`, `goggalaxy://openGameView/<id>`). They're built only from validated IDs.

### Safety model

Every deletion goes through one function, `core::remove`. It re-checks a per-tool allowlist **immediately before** deleting.

| Tool | Allowed |
|---|---|
| Clean | A direct child of one of that category's root folders (re-read at clean time), with matching filename prefix where relevant |
| Big Files, Duplicates, Disk Map | Inside your profile or personal folders, but not the folder itself, not `AppData`, `.ssh`, `Saved Games`, `Documents\My Games`, `Rockstar Games` or `Electronic Arts`. On other drives: at least two levels deep and outside `Windows`, `Program Files`, `ProgramData`, `$Recycle.Bin`, `System Volume Information` |
| Uninstaller leftovers | One or two levels inside `%APPDATA%`, `%LOCALAPPDATA%`, `LocalLow`, `%ProgramData%` or `Program Files`, and never a shared vendor folder (Microsoft, NVIDIA, Steam…) |
| Game leftovers | Must be in the freshly re-computed leftovers list |

Additional rules:
- **Links are never followed.** Paths are resolved through their *parent* only, so a symlink or junction is judged and removed as the link itself, never its target.
- **"Never touch" blocks a path in both directions:** if it *is*, *is inside*, or *contains* an excluded path. It's checked at scan time and again at delete time.
- **Permanent deletes are best-effort.** Locked files are skipped and counted. Read-only files have the attribute cleared and are retried once.
- **No shell, no user-built commands.** Every command is a fixed `System32` executable with fixed arguments, started without a console window. Uninstall commands are re-read from the registry by ID (never taken from the UI) and started with `ShellExecuteEx`, so installers can raise their own UAC prompt.
- **No arbitrary URLs.** Settings links come from a fixed allowlist.

### Where your data lives

| What | Where |
|---|---|
| Settings | `%APPDATA%\WinCleaner for Gamers\settings.json` |
| History & XP | `%APPDATA%\WinCleaner for Gamers\history.json` (last 200 operations) |
| Scheduled clean log | `%LOCALAPPDATA%\WinCleaner for Gamers\autoclean.log` |
| WebView data | `%LOCALAPPDATA%\com.marknap.wincleaner\` |

### Scheduled cleaning

Turning on **Clean automatically** creates a Task Scheduler task named **`WinCleaner for Gamers AutoClean`**. It runs daily at 12:00, or every N days, with:

```
"C:\…\wincleaner.exe" --auto-clean
```

That run is headless: no window, auto-clean categories only, and anything in use is skipped. The result is added to History and to `autoclean.log`. Turning the option off deletes the task.

### Health grade and XP

**Health score** starts at 100 and loses points for:

| Finding | Penalty |
|---|---|
| Junk | 6 per GB, max 35 |
| Startup apps marked "safe to disable" that are on | 4 each, max 20 |
| Game leftovers | 2 per GB, max 10 |
| System drive under 20% free | 10 (20 if under 10% free) |

Grades: **S** ≥ 95, **A** ≥ 85, **B** ≥ 70, **C** ≥ 50, **D** below that.

**XP** = MB freed + 100 per boost + 25 per scan.

| Rank | Rookie | Bronze | Silver | Gold | Platinum | Diamond | Legend |
|---|---|---|---|---|---|---|---|
| XP | 0 | 1,000 | 5,000 | 15,000 | 40,000 | 100,000 | 250,000 |

---

## Build it yourself

**Requirements:** Node 20+, Rust (stable), and on Windows the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools; WebView2 is already part of Windows 10/11).

```powershell
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # release build
```

`npm run tauri build`:
1. builds the UI into `dist/`
2. compiles the Rust backend in release mode with the UI embedded
3. packages an NSIS installer

| Output | Path |
|---|---|
| App | `src-tauri/target/release/wincleaner.exe` |
| Installer | `src-tauri/target/release/bundle/nsis/WinCleaner for Gamers_<version>_x64-setup.exe` |

**No Windows machine?** Push to GitHub. `.github/workflows/build.yml` builds the installer on `windows-latest` and uploads it as a workflow artifact.

**UI-only preview (any OS):** `npm run dev`, then open http://localhost:1420. Outside Tauri the UI runs on sample data from `src/mock.ts`.

**Compile-check the backend from macOS or Linux:**

```sh
rustup target add x86_64-pc-windows-msvc
brew install llvm                       # provides llvm-rc, needed for Windows resources
PATH="$(brew --prefix llvm)/bin:$PATH" npm run check:win
```

---

## Project layout

```
src/                     React UI
  App.tsx                Window chrome, sidebar, toasts, shared state
  pages/                 One file per screen
  api.ts                 Typed backend commands (+ mock fallback)
  mock.ts                Sample data for browser preview
  components.tsx         Buttons, toggles, charts, icons
  styles.css             The whole look
src-tauri/
  tauri.conf.json        Window, CSP, installer config
  capabilities/          What the UI is allowed to call
  src/
    main.rs              Commands, tray icon, --auto-clean entry point
    core.rs              Paths, safety rules, removal, progress, Windows helpers
    clean.rs             Junk categories, scanning and cleaning
    games.rs             Steam/Epic/GOG library, leftovers, launcher links
    boost.rs             Game Boost, quick fixes, tweaks
    startup.rs           Startup apps (StartupApproved)
    apps.rs              Installed programs, uninstall, leftovers
    files.rs             Big files, duplicates
    analyze.rs           Disk Map tree
    status.rs            Live stats (sysinfo, PDH, ICMP, nvidia-smi)
    history.rs           History log and Put back
    prefs.rs             Settings and Task Scheduler
```

---

## Removing WinCleaner

1. Turn off **Clean automatically** in Settings first. This removes the scheduled task.
2. Uninstall via **Settings → Apps → Installed apps → WinCleaner for Gamers**.
3. Optionally delete `%APPDATA%\WinCleaner for Gamers` to remove your settings and history.

Startup apps you disabled and gaming settings you changed stay as they are. Switch them back in the app before uninstalling if you want the originals.
