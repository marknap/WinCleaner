// Fake backend used only when the UI runs in a normal browser (`npm run dev`),
// so the interface can be designed and previewed without Windows.
import type * as A from "./api";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = Math.floor(Date.now() / 1000);
const day = 86400;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let prefs: A.Prefs = {
  language: "auto", cleanToRecycleBin: false, confirmedPermanent: false, largeMinMb: 500, oldDays: 180, excluded: [], scheduleEnabled: false, scheduleDays: 7,
  proMode: false, closeToTray: false, restorePoints: true, boostClose: [], pinnedCards: [], achievementsSeen: [], presentmonPath: null, onboarded: true,
  prevPowerScheme: null, boostScheme: null, boostActive: false, lastRestorePoint: 0, recentUninstalls: [{ name: "Overwolf", publisher: "Overwolf Ltd.", location: "", date: now - 5 * day }],
};
const browserLang = (): "en" | "nl" => (prefs.language === "auto" ? (navigator.language.startsWith("nl") ? "nl" : "en") : prefs.language);

const item = (name: string, size: number, inUse = false): A.CleanItem => ({ path: `C:\\mock\\${name}`, name, size, inUse });

const groups: A.CleanGroup[] = [
  { id: "usertemp", name: "Temporary files", group: "windows", detail: "Leftovers from installers and apps. Anything used in the last 24 hours is kept.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("NVIDIA Corporation", 1.4 * GB), item("chrome_installer.log", 3 * MB), item("_MEI82402", 220 * MB)] },
  { id: "wintemp", name: "Windows temp files", group: "windows", detail: "System-wide temporary files.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: true, locked: true, inUse: false, total: 0, items: [] },
  { id: "crashdumps", name: "App crash reports", group: "windows", detail: "Crash dumps and error reports from apps and games.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("eldenring.exe.4412.dmp", 640 * MB)] },
  { id: "recyclebin", name: "Recycle Bin", group: "windows", detail: "Everything currently in the Recycle Bin, on all drives.", warning: "Emptying it means files you recycled can't be put back.", defaultSelected: false, autoClean: false, needsAdmin: false, locked: false, inUse: false, total: 0, items: [{ path: "::recyclebin", name: "84 items", size: 2.1 * GB, inUse: false }] },
  { id: "steamweb", name: "Steam web cache", group: "gaming", detail: "Store pages, images and the in-game overlay browser cache.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("htmlcache", 890 * MB)] },
  { id: "epic", name: "Epic Games Launcher cache", group: "gaming", detail: "Launcher web cache and logs.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("webcache_4430", 410 * MB)] },
  { id: "discord", name: "Discord cache", group: "gaming", detail: "Cached images, videos and emoji.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: true, total: 0, items: [item("Cache", 760 * MB, true)] },
  { id: "driverinstallers", name: "Old GPU driver installers", group: "gaming", detail: "Setup files left behind by NVIDIA and AMD driver installs.", warning: null, defaultSelected: true, autoClean: false, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("DisplayDriver", 1.9 * GB)] },
  { id: "shadercache", name: "GPU shader cache", group: "gaming", detail: "Compiled shaders from NVIDIA, AMD, Intel and DirectX.", warning: "Games rebuild shaders on next launch (a bit of stutter at first). Great fix after a driver update or for graphical glitches.", defaultSelected: false, autoClean: false, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("DXCache", 1.1 * GB)] },
  { id: "chrome", name: "Chrome cache", group: "browsers", detail: "Cached web pages, images and scripts.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("Cache_Data", 520 * MB), item("Code Cache", 140 * MB)] },
  { id: "edge", name: "Edge cache", group: "browsers", detail: "Cached web pages, images and scripts.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: true, total: 0, items: [item("Cache_Data", 210 * MB, true)] },
  { id: "pkgcaches", name: "Package manager caches", group: "developer", detail: "npm, pip, Yarn, NuGet and Go download caches.", warning: null, defaultSelected: true, autoClean: true, needsAdmin: false, locked: false, inUse: false, total: 0, items: [item("npm-cache", 1.3 * GB)] },
];
groups.forEach((g) => (g.total = g.items.reduce((a, i) => a + i.size, 0)));

const games: A.Game[] = ([
  { launcher: "steam", id: "1245620", name: "ELDEN RING", path: "D:\\SteamLibrary\\steamapps\\common\\ELDEN RING", size: 61 * GB, lastPlayed: now - 3 * day, drive: "D:" },
  { launcher: "steam", id: "1091500", name: "Cyberpunk 2077", path: "D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077", size: 78 * GB, lastPlayed: now - 140 * day, drive: "D:" },
  { launcher: "steam", id: "730", name: "Counter-Strike 2", path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive", size: 34 * GB, lastPlayed: now - day / 2, drive: "C:" },
  { launcher: "steam", id: "1086940", name: "Baldur's Gate 3", path: "D:\\SteamLibrary\\steamapps\\common\\Baldurs Gate 3", size: 122 * GB, lastPlayed: now - 240 * day, drive: "D:" },
  { launcher: "epic", id: "Fortnite", name: "Fortnite", path: "C:\\Program Files\\Epic Games\\Fortnite", size: 44 * GB, lastPlayed: null, drive: "C:" },
  { launcher: "gog", id: "1207664663", name: "The Witcher 3: Wild Hunt", path: "D:\\GOG Games\\The Witcher 3", size: 49 * GB, lastPlayed: null, drive: "D:", uninstallId: null },
  { launcher: "battlenet", id: "HKLM32|Overwatch", name: "Overwatch", path: "C:\\Program Files (x86)\\Overwatch", size: 48 * GB, lastPlayed: null, drive: "C:", uninstallId: "HKLM32|Overwatch" },
] as Omit<A.Game, "uninstallId">[]).map((g) => ({ uninstallId: null, ...g })) as A.Game[];

const startup: A.StartupItem[] = [
  { id: "hkcu|Steam", name: "Steam", command: "\"C:\\Program Files (x86)\\Steam\\steam.exe\" -silent", location: "You", enabled: true, needsAdmin: false, advice: "disable", adviceText: "Opens by itself when you launch a game." },
  { id: "hkcu|Discord", name: "Discord", command: "Update.exe --processStart Discord.exe", location: "You", enabled: true, needsAdmin: false, advice: "optional", adviceText: "Disable if you only use Discord while gaming." },
  { id: "hkcu|EpicGamesLauncher", name: "Epic Games Launcher", command: "EpicGamesLauncher.exe -silent", location: "You", enabled: true, needsAdmin: false, advice: "disable", adviceText: "Open it when you want to play." },
  { id: "hkcu|Spotify", name: "Spotify", command: "Spotify.exe /minimized", location: "You", enabled: true, needsAdmin: false, advice: "disable", adviceText: "Opens fast enough when you need it." },
  { id: "hklm|SecurityHealth", name: "Windows Security", command: "%windir%\\system32\\SecurityHealthSystray.exe", location: "All users", enabled: true, needsAdmin: true, advice: "keep", adviceText: "Protects your PC. Keep it on." },
  { id: "hklm|RtkAudUService", name: "Realtek Audio", command: "RtkAudUService64.exe", location: "All users", enabled: true, needsAdmin: true, advice: "keep", adviceText: "Audio driver. Keep it on." },
  { id: "hkcu|lghub", name: "Logitech G HUB", command: "lghub.exe --background", location: "You", enabled: true, needsAdmin: false, advice: "keep", adviceText: "Keep it if you use RGB lighting, DPI or macros." },
  { id: "hkcu|SomeUpdater", name: "SomeUpdater", command: "C:\\Users\\me\\AppData\\Local\\Some\\updater.exe", location: "You", enabled: false, needsAdmin: false, advice: "unknown", adviceText: "" },
];

const fixes: A.Fix[] = [
  { id: "dns", name: "Flush DNS cache", detail: "Fixes \"can't connect to server\" after network or DNS changes.", admin: false, slow: false, advanced: false, reboot: false },
  { id: "ram", name: "Free standby memory", detail: "Releases cached RAM so your game gets it right away. Helps with stutter on 8-16 GB PCs.", admin: true, slow: false, advanced: false, reboot: false },
  { id: "shaders", name: "Reset GPU shader cache", detail: "Fixes stutter and glitches after a driver update.", admin: false, slow: false, advanced: false, reboot: false },
  { id: "icons", name: "Rebuild icon cache", detail: "Fixes blank or wrong icons on the desktop and taskbar.", admin: false, slow: false, advanced: false, reboot: false },
  { id: "explorer", name: "Restart Explorer", detail: "Fixes a frozen taskbar, Start menu or desktop.", admin: false, slow: false, advanced: false, reboot: false },
  { id: "time", name: "Sync the clock", detail: "Some launchers and anti-cheat fail when the clock is off.", admin: true, slow: false, advanced: true, reboot: false },
  { id: "network", name: "Reset network stack", detail: "Last resort for broken internet. Needs a restart.", admin: true, slow: false, advanced: true, reboot: true },
  { id: "trim", name: "Optimize drives (TRIM)", detail: "Keeps SSDs fast. Can take a few minutes.", admin: true, slow: true, advanced: true, reboot: false },
  { id: "sfc", name: "Repair Windows system files", detail: "Scans and repairs Windows. Can take 10-20 minutes.", admin: true, slow: true, advanced: true, reboot: false },
];
const tweaks: A.Tweak[] = [
  { id: "gamemode", name: "Windows Game Mode", detail: "Windows prioritizes your game and pauses updates while you play.", on: true, recommended: true, admin: false, reboot: false, advanced: false },
  { id: "nodvr", name: "Turn off background recording", detail: "Stops Xbox Game Bar from silently recording gameplay, which costs FPS.", on: false, recommended: true, admin: false, reboot: false, advanced: false },
  { id: "highperf", name: "High performance power plan", detail: "Keeps your CPU at full speed. Uses more power on laptops.", on: false, recommended: true, admin: false, reboot: false, advanced: false },
  { id: "rawmouse", name: "Turn off mouse acceleration", detail: "Disables \"Enhance pointer precision\" for consistent aim.", on: false, recommended: true, admin: false, reboot: false, advanced: true },
  { id: "hags", name: "Hardware-accelerated GPU scheduling", detail: "Lets your GPU manage its own memory. Required for DLSS Frame Generation.", on: true, recommended: true, admin: true, reboot: true, advanced: true },
];

const history: A.HistoryFile = {
  lifetimeFreed: 7.4 * GB, lifetimeItems: 1320, boosts: 6, scans: 14, startupDisabled: 2, tweaks: 1, benchmarks: 0,
  activeDays: [0, 3, 9, 16, 24].map((d) => Math.floor(now / day) - d),
  entries: [
    { id: "1", date: now - 2 * day, tool: "Clean", freed: 3.2 * GB, items: [{ path: "C:\\Users\\me\\AppData\\Local\\Temp\\NVIDIA Corporation", size: 1.4 * GB, recycled: false, restored: false }, { path: "C:\\Users\\me\\Downloads\\old-setup.exe", size: 300 * MB, recycled: true, restored: false }] },
    { id: "2", date: now - 9 * day, tool: "Game leftovers", freed: 4.2 * GB, items: [{ path: "D:\\SteamLibrary\\steamapps\\common\\Apex Legends", size: 4.2 * GB, recycled: true, restored: false }] },
  ],
};

let tick = 0;
const hist: Record<string, unknown> = {
  dup_default_roots: ["C:\\Users\\me\\Desktop", "C:\\Users\\me\\Documents", "C:\\Users\\me\\Downloads", "C:\\Users\\me\\Pictures", "C:\\Users\\me\\Videos"],
  drives: [{ path: "C:\\", name: "System", free: 88 * GB, total: 931 * GB }, { path: "D:\\", name: "Games", free: 412 * GB, total: 1863 * GB }],
  clips_summary: { count: 140, size: 23 * GB, folder: "C:\\Users\\me\\Videos" },
  recent_uninstalls: [{ name: "Overwolf", publisher: "Overwolf Ltd.", location: "", date: now - 5 * day }],
};

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "system_info": return r({ isAdmin: false, version: "0.2.0", os: "Windows 11 Pro 24H2", host: "BATTLESTATION", cpu: "AMD Ryzen 7 7800X3D 8-Core Processor", ram: 32 * GB, language: browserLang(), presentmon: !!prefs.presentmonPath });
    case "ping_regions": await wait(700); return r([["euw", "EU West (Ireland)", 24], ["euc", "EU Central (Frankfurt)", 12], ["uk", "UK (London)", 15], ["eun", "EU North (Stockholm)", 31], ["use", "US East (Virginia)", 88], ["usw", "US West (Oregon)", 152], ["sa", "South America (São Paulo)", 201], ["asia", "Asia (Tokyo)", 238], ["sea", "Southeast Asia (Singapore)", 172], ["oce", "Oceania (Sydney)", null]].map(([id, name, ms]) => ({ id, name, ms })));
    case "fps_benchmark": await wait(1500); return r({ process: args!.process, frames: 4210, seconds: 30, avgFps: 140.3, low1: 96.2, low01: 61.8, avgMs: 7.1, maxMs: 21.4 });
    case "app_leftovers": case "recent_leftovers": await wait(400); return r([{ path: "C:\\Users\\me\\AppData\\Roaming\\Overwolf", size: 410 * MB, personal: true, kind: "folder" }, { path: "HKCU\\Software\\Overwolf", size: 0, personal: true, kind: "registry" }]);
    case "restore_point_create": await wait(800); prefs.lastRestorePoint = Math.floor(Date.now() / 1000); return r("Restore point created");
    // The real app reads this art from Steam's local cache instead.
    case "game_art": return r(`https://cdn.cloudflare.steamstatic.com/steam/apps/${args!.appid}/header.jpg`);
    case "get_prefs": return r({ ...prefs });
    case "set_prefs": prefs = { ...(args!.p as A.Prefs) }; return r(prefs);
    case "clean_scan": await wait(1600); return r(structuredClone(groups));
    case "clean_run": { await wait(900); const t = args!.targets as A.CleanTarget[]; const freed = t.reduce((a, x) => a + x.size, 0); return r({ freed, removed: t.length, skipped: 3, failed: [], message: `GG! Freed ${(freed / GB).toFixed(1)} GB · 3 files in use were skipped` }); }
    case "games_list": await wait(500); return r({ games, launchers: ["steam", "epic", "gog"], leftovers: [{ path: "D:\\SteamLibrary\\steamapps\\common\\Apex Legends", name: "Apex Legends", size: 4.2 * GB, kind: "game", note: "Folder from an uninstalled game. May contain mods or old saves.", inUse: false }, { path: "D:\\SteamLibrary\\steamapps\\downloading\\1172470", name: "1172470", size: 1.3 * GB, kind: "download", note: "Unfinished or cancelled download.", inUse: false }] });
    case "startup_list": await wait(200); return r(structuredClone(startup));
    case "startup_set": { const s = startup.find((x) => x.id === args!.id); if (s) s.enabled = args!.enabled as boolean; return r(null); }
    case "large_scan": await wait(900); return r([
      { path: "C:\\Users\\me\\Downloads\\Win11_24H2.iso", name: "Win11_24H2.iso", folder: "C:\\Users\\me\\Downloads", size: 5.8 * GB, modified: now - 300 * day },
      { path: "C:\\Users\\me\\Videos\\Clips\\ace-clutch.mp4", name: "ace-clutch.mp4", folder: "C:\\Users\\me\\Videos\\Clips", size: 2.4 * GB, modified: now - 20 * day },
      { path: "C:\\Users\\me\\Downloads\\SteamSetup.exe", name: "SteamSetup.exe", folder: "C:\\Users\\me\\Downloads", size: 9 * MB, modified: now - 400 * day },
      { path: "C:\\Users\\me\\Downloads\\mods-pack.zip", name: "mods-pack.zip", folder: "C:\\Users\\me\\Downloads", size: 780 * MB, modified: now - 200 * day },
    ]);
    case "boost_state": return r({ fixes, tweaks: structuredClone(tweaks), boostActive: prefs.boostActive });
    case "boost_fix": await wait(900); return r({ ok: true, message: "Done" });
    case "tweak_set": { const t = tweaks.find((x) => x.id === args!.id); if (t) t.on = args!.on as boolean; return r(null); }
    case "boost_candidates": return r([
      { name: "onedrive.exe", label: "OneDrive", memory: 180 * MB, count: 1, selected: true, suggested: true },
      { name: "ms-teams.exe", label: "Microsoft Teams", memory: 640 * MB, count: 4, selected: true, suggested: true },
      { name: "chrome.exe", label: "chrome", memory: 2.1 * GB, count: 23, selected: false, suggested: false },
      { name: "spotify.exe", label: "spotify", memory: 310 * MB, count: 5, selected: false, suggested: false },
    ]);
    case "game_boost": await wait(1500); prefs.boostActive = true; return r({ ramFreed: 1.7 * GB, steps: [{ label: "Closed background apps", ok: true, detail: "2 of 2 closed." }, { label: "High performance power", ok: true, detail: "Enabled" }, { label: "Game Mode", ok: true, detail: "Already on" }, { label: "Flush DNS", ok: true, detail: "DNS cache flushed" }, { label: "Free standby memory", ok: false, detail: "Skipped (needs admin)" }] });
    case "boost_restore": prefs.boostActive = false; return r(null);
    case "status_sample": {
      tick++;
      const w = (b: number, a: number) => b + Math.sin(tick / 3) * a + Math.random() * a;
      return r({
        cpu: w(28, 12), cores: Array.from({ length: 16 }, (_, i) => w(15 + (i % 5) * 9, 10)), cpuName: "AMD Ryzen 7 7800X3D 8-Core Processor",
        memUsed: 14.2 * GB + Math.random() * 300 * MB, memTotal: 32 * GB, gpu: w(55, 15), gpuExtra: { name: "NVIDIA GeForce RTX 4080", temp: 61 + Math.random() * 3, vramUsed: 7.1 * GB, vramTotal: 16 * GB }, cpuTemp: 58 + Math.random() * 4,
        netIn: w(2.4, 1.5) * MB, netOut: w(0.3, 0.2) * MB, ping: Math.round(w(14, 3)), disks: hist.drives, battery: null, uptime: 3 * day + 4000,
        procs: [{ pid: 1, name: "eldenring.exe", cpu: 24.1, memory: 9.2 * GB }, { pid: 2, name: "chrome.exe", cpu: 3.2, memory: 1.1 * GB }, { pid: 3, name: "Discord.exe", cpu: 1.4, memory: 420 * MB }, { pid: 4, name: "steamwebhelper.exe", cpu: 0.8, memory: 380 * MB }, { pid: 5, name: "dwm.exe", cpu: 0.7, memory: 140 * MB }],
      });
    }
    case "history_get": return r(structuredClone(history));
    case "apps_list": await wait(400); return r([
      { id: "a", name: "Discord", publisher: "Discord Inc.", version: "1.0.9170", size: 420 * MB, installDate: "20250102", location: "", isGame: false, machineWide: false },
      { id: "b", name: "Riot Vanguard", publisher: "Riot Games, Inc.", version: "1.17", size: 52 * MB, installDate: "20240910", location: "C:\\Program Files\\Riot Vanguard", isGame: true, machineWide: true },
      { id: "c", name: "WinRAR 7.01 (64-bit)", publisher: "win.rar GmbH", version: "7.01", size: 9 * MB, installDate: "20240501", location: "C:\\Program Files\\WinRAR", isGame: false, machineWide: true },
    ]);
    case "app_uninstall": await wait(1200); return r({ stillInstalled: false, message: "Uninstalled", leftovers: [{ path: "C:\\Users\\me\\AppData\\Roaming\\discord", size: 230 * MB, personal: true, kind: "folder" }, { path: "C:\\Users\\me\\AppData\\Local\\Discord", size: 90 * MB, personal: false, kind: "folder" }, { path: "HKCU\\Software\\Discord", size: 0, personal: true, kind: "registry" }] });
    case "analyze_scan": case "analyze_open": await wait(cmd === "analyze_scan" ? 1200 : 50); return r({
      root: "C:\\", path: (args?.path as string) ?? "C:\\", name: "C:\\", size: 840 * GB, children: [
        { name: "Program Files (x86)", path: "C:\\Program Files (x86)", size: 310 * GB, isDir: true, kind: "folder", bucket: 0 },
        { name: "Users", path: "C:\\Users", size: 220 * GB, isDir: true, kind: "folder", bucket: 0 },
        { name: "Windows", path: "C:\\Windows", size: 38 * GB, isDir: true, kind: "folder", bucket: 0 },
        { name: "Program Files", path: "C:\\Program Files", size: 120 * GB, isDir: true, kind: "folder", bucket: 0 },
        { name: "pagefile.sys", path: "C:\\pagefile.sys", size: 24 * GB, isDir: false, kind: "other", bucket: 0 },
        { name: "hiberfil.sys", path: "C:\\hiberfil.sys", size: 12 * GB, isDir: false, kind: "other", bucket: 0 },
        { name: "clips.mp4", path: "C:\\clips.mp4", size: 8 * GB, isDir: false, kind: "video", bucket: 0 },
        { name: "XboxGames", path: "C:\\XboxGames", size: 90 * GB, isDir: true, kind: "folder", bucket: 0 },
        { name: "214 smaller items", path: "", size: 2 * GB, isDir: false, kind: "bucket", bucket: 214 },
      ],
    });
    default:
      if (cmd in hist) return r(hist[cmd]);
      await wait(400);
      return r({ freed: 0, removed: 0, skipped: 0, failed: [], message: "Done (preview mode)" });
  }
}
