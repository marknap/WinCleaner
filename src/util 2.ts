export function bytes(b: number, digits = 1): string {
  if (!b || b < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${b} B` : `${v.toFixed(v >= 100 ? 0 : digits)} ${u[i]}`;
}

export function timeAgo(secs: number | null | undefined): string {
  if (!secs) return "Never";
  const d = Date.now() / 1000 - secs;
  if (d < 60) return "Just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  const days = Math.floor(d / 86400);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)} year${days < 730 ? "" : "s"} ago`;
}

export function date(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function duration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Ranks: earned from space freed, boosts and scans.
// ---------------------------------------------------------------------------

export interface Rank { name: string; min: number; color: string; next?: number }

export const RANKS: Rank[] = [
  { name: "Rookie", min: 0, color: "#8a93b8" },
  { name: "Bronze", min: 1000, color: "#d08a4a" },
  { name: "Silver", min: 5000, color: "#c9d3e6" },
  { name: "Gold", min: 15000, color: "#ffc93c" },
  { name: "Platinum", min: 40000, color: "#4ef2d0" },
  { name: "Diamond", min: 100000, color: "#7aa8ff" },
  { name: "Legend", min: 250000, color: "#ff2bd6" },
];

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
  if (score >= 95) return { letter: "S", color: "#39ff88", text: "Flawless. Your rig is tournament ready." };
  if (score >= 85) return { letter: "A", color: "#00f0ff", text: "Great shape. A quick clean and you're perfect." };
  if (score >= 70) return { letter: "B", color: "#7aa8ff", text: "Solid, but there's loot to collect." };
  if (score >= 50) return { letter: "C", color: "#ffb020", text: "Some junk is slowing you down." };
  return { letter: "D", color: "#ff4d6d", text: "Time for a serious cleanup." };
}
