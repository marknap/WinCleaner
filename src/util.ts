import { L, locale } from "./i18n";

export function num(v: number, digits = 0): string {
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function bytes(b: number, digits = 1): string {
  if (!b || b < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${b} B` : `${num(v, v >= 100 ? 0 : digits)} ${u[i]}`;
}

export function timeAgo(secs: number | null | undefined): string {
  if (!secs) return L("Never", "Nooit");
  const d = Date.now() / 1000 - secs;
  if (d < 60) return L("Just now", "Zojuist");
  if (d < 3600) return L(`${Math.floor(d / 60)} min ago`, `${Math.floor(d / 60)} min geleden`);
  if (d < 86400) return L(`${Math.floor(d / 3600)} h ago`, `${Math.floor(d / 3600)} uur geleden`);
  const days = Math.floor(d / 86400);
  if (days < 31) return L(`${days} day${days === 1 ? "" : "s"} ago`, `${days} dag${days === 1 ? "" : "en"} geleden`);
  if (days < 365) {
    const m = Math.floor(days / 30);
    return L(`${m} month${m === 1 ? "" : "s"} ago`, `${m} maand${m === 1 ? "" : "en"} geleden`);
  }
  const y = Math.floor(days / 365);
  return L(`${y} year${y === 1 ? "" : "s"} ago`, `${y} jaar geleden`);
}

export function date(secs: number): string {
  return new Date(secs * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

export function duration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}${L("d", "d")} ${h}${L("h", "u")}` : `${h}${L("h", "u")} ${m}m`;
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Ranks: earned from space freed, boosts and scans.
// ---------------------------------------------------------------------------

export interface Rank { id: string; min: number; color: string }

export const RANKS: Rank[] = [
  { id: "rookie", min: 0, color: "#8a93b8" },
  { id: "bronze", min: 1000, color: "#d08a4a" },
  { id: "silver", min: 5000, color: "#c9d3e6" },
  { id: "gold", min: 15000, color: "#ffc93c" },
  { id: "platinum", min: 40000, color: "#4ef2d0" },
  { id: "diamond", min: 100000, color: "#7aa8ff" },
  { id: "legend", min: 250000, color: "#ff2bd6" },
];

export function rankName(r: Rank): string {
  const n: Record<string, [string, string]> = {
    rookie: ["Rookie", "Rookie"], bronze: ["Bronze", "Brons"], silver: ["Silver", "Zilver"], gold: ["Gold", "Goud"],
    platinum: ["Platinum", "Platina"], diamond: ["Diamond", "Diamant"], legend: ["Legend", "Legende"],
  };
  return L(...n[r.id]);
}

export function xpOf(h: { lifetimeFreed: number; boosts: number; scans: number }): number {
  return Math.floor(h.lifetimeFreed / 1024 ** 2) + h.boosts * 100 + h.scans * 25;
}

export function rankOf(xp: number): { rank: Rank; next: Rank | null; progress: number } {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].min) i++;
  const rank = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  const progress = next ? (xp - rank.min) / (next.min - rank.min) : 1;
  return { rank, next, progress };
}

/** Health grade from the Smart Scan findings. */
export function grade(score: number): { letter: string; color: string; text: string } {
  if (score >= 95) return { letter: "S", color: "#39ff88", text: L("Flawless. Your rig is tournament ready.", "Vlekkeloos. Je rig is klaar voor het toernooi.") };
  if (score >= 85) return { letter: "A", color: "#00f0ff", text: L("Great shape. A quick clean and you're perfect.", "Topvorm. Even snel opschonen en je bent perfect.") };
  if (score >= 70) return { letter: "B", color: "#7aa8ff", text: L("Solid, but there's loot to collect.", "Prima, maar er ligt nog loot klaar.") };
  if (score >= 50) return { letter: "C", color: "#ffb020", text: L("Some junk is slowing you down.", "Er zit rommel in de weg.") };
  return { letter: "D", color: "#ff4d6d", text: L("Time for a serious cleanup.", "Tijd voor een flinke schoonmaak.") };
}

/** History tool ids (older versions stored English labels). */
export function toolLabel(tool: string): string {
  const t: Record<string, [string, string]> = {
    clean: ["Clean", "Opschonen"], smart: ["Smart Scan", "Slimme scan"], quick: ["Quick Clean", "Snel opschonen"],
    scheduled: ["Scheduled clean", "Geplande schoonmaak"], shader: ["Shader cache reset", "Shadercache gereset"],
    bigfiles: ["Big Files", "Grote bestanden"], duplicates: ["Duplicates", "Duplicaten"], leftovers: ["Uninstall leftovers", "Restjes na verwijderen"],
    gameleftovers: ["Game leftovers", "Game-restjes"], diskmap: ["Disk Map", "Schijfkaart"],
  };
  const v = t[tool];
  return v ? L(...v) : tool;
}

/** Normalizes legacy English tool labels to ids. */
export function toolId(tool: string): string {
  const legacy: Record<string, string> = {
    Clean: "clean", "Smart Scan": "smart", "Quick Clean": "quick", "Scheduled clean": "scheduled", "Shader cache reset": "shader",
    "Big files": "bigfiles", Duplicates: "duplicates", "Uninstall leftovers": "leftovers", "Game leftovers": "gameleftovers", "Disk Map": "diskmap",
  };
  return legacy[tool] ?? tool;
}
