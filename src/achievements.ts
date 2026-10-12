import type { HistoryFile } from "./api";
import type { IconName } from "./components";
import { L } from "./i18n";
import { toolId } from "./util";

export interface Achievement {
  id: string;
  icon: IconName;
  color: string;
  name: () => string;
  desc: () => string;
  test: (h: HistoryFile) => boolean;
}

const GB = 1024 ** 3;
const used = (h: HistoryFile, ...tools: string[]) => h.entries.some((e) => tools.includes(toolId(e.tool)));

/** Consecutive weeks (Monday-based) with any activity, ending this week or last week. */
export function weekStreak(h: HistoryFile): number {
  const week = (day: number) => Math.floor((day + 3) / 7); // 1970-01-01 was a Thursday
  const weeks = new Set(h.activeDays.map(week));
  let w = week(Math.floor(Date.now() / 86400000));
  if (!weeks.has(w)) w -= 1;
  let n = 0;
  while (weeks.has(w)) {
    n++;
    w--;
  }
  return n;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_clean", icon: "sparkle", color: "#39ff88", name: () => L("First Blood", "First Blood"), desc: () => L("Clean junk for the first time.", "Ruim voor het eerst rommel op."), test: (h) => h.lifetimeFreed > 0 },
  { id: "first_boost", icon: "rocket", color: "#ff2bd6", name: () => L("Liftoff", "Lancering"), desc: () => L("Use Game Boost.", "Gebruik Game Boost."), test: (h) => h.boosts >= 1 },
  { id: "boost_10", icon: "bolt", color: "#ff2bd6", name: () => L("Speed Demon", "Snelheidsduivel"), desc: () => L("Boost 10 times.", "Boost 10 keer."), test: (h) => h.boosts >= 10 },
  { id: "gb_1", icon: "disk", color: "#d08a4a", name: () => L("1 GB Club", "1 GB-club"), desc: () => L("Free 1 GB in total.", "Maak in totaal 1 GB vrij."), test: (h) => h.lifetimeFreed >= GB },
  { id: "gb_10", icon: "disk", color: "#c9d3e6", name: () => L("10 GB Club", "10 GB-club"), desc: () => L("Free 10 GB in total.", "Maak in totaal 10 GB vrij."), test: (h) => h.lifetimeFreed >= 10 * GB },
  { id: "gb_50", icon: "disk", color: "#ffc93c", name: () => L("Space Hunter", "Ruimtejager"), desc: () => L("Free 50 GB in total.", "Maak in totaal 50 GB vrij."), test: (h) => h.lifetimeFreed >= 50 * GB },
  { id: "gb_100", icon: "trophy", color: "#7aa8ff", name: () => L("Terabyte Tamer", "Terabyte-temmer"), desc: () => L("Free 100 GB in total.", "Maak in totaal 100 GB vrij."), test: (h) => h.lifetimeFreed >= 100 * GB },
  { id: "scan_10", icon: "search", color: "#00f0ff", name: () => L("Scout", "Verkenner"), desc: () => L("Run 10 scans.", "Voer 10 scans uit."), test: (h) => h.scans >= 10 },
  { id: "startup_3", icon: "power", color: "#7aa8ff", name: () => L("Startup Slayer", "Opstartslachter"), desc: () => L("Disable 3 startup apps.", "Zet 3 opstartapps uit."), test: (h) => h.startupDisabled >= 3 },
  { id: "leftovers", icon: "gamepad", color: "#ffc93c", name: () => L("Leftover Hunter", "Restjesjager"), desc: () => L("Remove leftovers of an uninstalled game.", "Verwijder restjes van een verwijderde game."), test: (h) => used(h, "gameleftovers") },
  { id: "dupes", icon: "copy", color: "#b98cff", name: () => L("Clone Wars", "Kloonoorlog"), desc: () => L("Remove duplicate files.", "Verwijder dubbele bestanden."), test: (h) => used(h, "duplicates") },
  { id: "uninstall", icon: "package", color: "#ff6b8b", name: () => L("Clean Exit", "Schone aftocht"), desc: () => L("Remove an app's leftovers.", "Verwijder de restjes van een app."), test: (h) => used(h, "leftovers") },
  { id: "tweaker", icon: "wrench", color: "#4ef2d0", name: () => L("Tweaker", "Tweaker"), desc: () => L("Turn on 3 gaming settings.", "Zet 3 game-instellingen aan."), test: (h) => h.tweaks >= 3 },
  { id: "bench", icon: "gauge", color: "#39ff88", name: () => L("Benchmarker", "Benchmarker"), desc: () => L("Run an FPS benchmark.", "Voer een FPS-benchmark uit."), test: (h) => h.benchmarks >= 1 },
  { id: "streak_4", icon: "flame", color: "#ff8a3d", name: () => L("On Fire", "On Fire"), desc: () => L("Use WinCleaner 4 weeks in a row.", "Gebruik WinCleaner 4 weken op rij."), test: (h) => weekStreak(h) >= 4 },
  { id: "legend", icon: "star", color: "#ff2bd6", name: () => L("Legendary", "Legendarisch"), desc: () => L("Reach Legend rank.", "Bereik de rang Legende."), test: (h) => Math.floor(h.lifetimeFreed / 1024 ** 2) + h.boosts * 100 + h.scans * 25 >= 250000 },
];

export const unlocked = (h: HistoryFile) => ACHIEVEMENTS.filter((a) => a.test(h)).map((a) => a.id);
