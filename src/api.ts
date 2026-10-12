import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mockInvoke } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? tauriInvoke<T>(cmd, args) : mockInvoke<T>(cmd, args);
}

export function onEvent<T>(name: string, cb: (payload: T) => void): () => void {
  if (!isTauri) return () => {};
  let un: (() => void) | undefined;
  let dead = false;
  listen<T>(name, (e) => cb(e.payload)).then((u) => (dead ? u() : (un = u)));
  return () => {
    dead = true;
    un?.();
  };
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false });
  return typeof r === "string" ? r : null;
}

export async function pickPath(directory: boolean): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory, multiple: false });
  return typeof r === "string" ? r : null;
}

export async function pickFile(extensions: string[], name: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, filters: [{ name, extensions }] });
  return typeof r === "string" ? r : null;
}

export async function pickSave(defaultPath: string, extensions: string[], name: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath, filters: [{ name, extensions }] })) ?? null;
}

export async function windowAction(a: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (a === "minimize") await w.minimize();
  else if (a === "toggleMaximize") await w.toggleMaximize();
  else await w.close();
}

// ---------------------------------------------------------------------------
// Types (mirror the Rust structs)
// ---------------------------------------------------------------------------

export interface Progress { phase: string; current: string; bytes: number; items: number }

export interface SysInfo { isAdmin: boolean; version: string; os: string; host: string; cpu: string; ram: number; language: "en" | "nl"; presentmon: boolean }

export interface RecentUninstall { name: string; publisher: string; location: string; date: number }

export interface Prefs {
  language: "auto" | "en" | "nl";
  cleanToRecycleBin: boolean;
  confirmedPermanent: boolean;
  largeMinMb: number;
  oldDays: number;
  excluded: string[];
  scheduleEnabled: boolean;
  scheduleDays: number;
  proMode: boolean;
  closeToTray: boolean;
  restorePoints: boolean;
  boostClose: string[];
  pinnedCards: string[];
  achievementsSeen: string[];
  presentmonPath: string | null;
  onboarded: boolean;
  prevPowerScheme: string | null;
  boostScheme: string | null;
  boostActive: boolean;
  lastRestorePoint: number;
  recentUninstalls: RecentUninstall[];
}

export interface ActionResult { freed: number; removed: number; skipped: number; failed: string[]; message: string }

export interface CleanItem { path: string; name: string; size: number; inUse: boolean }
export interface CleanGroup {
  id: string; name: string; detail: string; group: "windows" | "gaming" | "browsers" | "developer";
  warning: string | null; defaultSelected: boolean; autoClean: boolean; needsAdmin: boolean;
  locked: boolean; inUse: boolean; total: number; items: CleanItem[];
}

export interface FileEntry { path: string; name: string; folder: string; size: number; modified: number }
export interface ClipsSummary { count: number; size: number; folder: string }
export interface DupFile { path: string; name: string; folder: string; modified: number; keep: boolean }
export interface DupGroup { id: string; size: number; wasted: number; files: DupFile[] }

export interface InstalledApp {
  id: string; name: string; publisher: string; version: string; size: number;
  installDate: string; location: string; isGame: boolean; machineWide: boolean;
}
export interface Leftover { path: string; size: number; personal: boolean; kind: "folder" | "registry" }
export interface UninstallResult { stillInstalled: boolean; message: string; leftovers: Leftover[] }

export type Launcher = "steam" | "epic" | "gog" | "battlenet";
export interface Game { launcher: Launcher; id: string; name: string; path: string; size: number; lastPlayed: number | null; drive: string; uninstallId: string | null }
export interface GameLeftover { path: string; name: string; size: number; kind: string; note: string; inUse: boolean }
export interface Library { games: Game[]; leftovers: GameLeftover[]; launchers: string[] }

export interface StartupItem {
  id: string; name: string; command: string; location: string; enabled: boolean;
  needsAdmin: boolean; advice: "keep" | "disable" | "optional" | "unknown"; adviceText: string;
}

export interface Fix { id: string; name: string; detail: string; admin: boolean; slow: boolean; advanced: boolean; reboot: boolean }
export interface Tweak { id: string; name: string; detail: string; on: boolean; recommended: boolean; admin: boolean; reboot: boolean; advanced: boolean }
export interface BoostState { fixes: Fix[]; tweaks: Tweak[]; boostActive: boolean }
export interface FixResult { ok: boolean; message: string }
export interface Candidate { name: string; label: string; memory: number; count: number; selected: boolean; suggested: boolean }
export interface BoostReport { steps: { label: string; ok: boolean; detail: string }[]; ramFreed: number }

export interface Drive { path: string; name: string; free: number; total: number }
export interface ChildView { name: string; path: string; size: number; isDir: boolean; kind: string; bucket: number }
export interface NodeView { root: string; path: string; name: string; size: number; children: ChildView[] }

export interface ProcInfo { pid: number; name: string; cpu: number; memory: number }
export interface Sample {
  cpu: number; cores: number[]; cpuName: string; memUsed: number; memTotal: number;
  gpu: number | null; gpuExtra: { name: string; temp: number | null; vramUsed: number | null; vramTotal: number | null } | null;
  cpuTemp: number | null;
  netIn: number; netOut: number; ping: number | null; disks: Drive[]; battery: [number, boolean] | null;
  uptime: number; procs: ProcInfo[];
}

export interface RegionPing { id: string; name: string; ms: number | null }
export interface Bench { process: string; frames: number; seconds: number; avgFps: number; low1: number; low01: number; avgMs: number; maxMs: number }

export interface HistoryItem { path: string; size: number; recycled: boolean; restored: boolean; backup?: string | null }
export interface HistoryEntry { id: string; date: number; tool: string; freed: number; items: HistoryItem[] }
export interface HistoryFile {
  entries: HistoryEntry[]; lifetimeFreed: number; lifetimeItems: number; boosts: number; scans: number;
  startupDisabled: number; tweaks: number; benchmarks: number; activeDays: number[];
}

export interface CleanTarget { category: string; path: string; size: number }
