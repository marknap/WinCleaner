import { createContext, useContext } from "react";
import type { CleanGroup, CleanTarget, HistoryFile, Prefs, Progress, SysInfo } from "./api";

export type Page =
  | "home" | "clean" | "boost" | "games" | "startup" | "performance"
  | "bigfiles" | "duplicates" | "uninstaller" | "diskmap" | "history" | "settings";

export interface Store {
  info: SysInfo | null;
  prefs: Prefs | null;
  savePrefs: (p: Partial<Prefs>) => Promise<void>;
  page: Page;
  go: (p: Page) => void;
  toast: (msg: string, kind?: "ok" | "err" | "info") => void;
  progress: Progress | null;
  history: HistoryFile | null;
  refreshHistory: () => void;
  celebrate: () => void;
  restartAdmin: () => void;
  clean: {
    groups: CleanGroup[] | null;
    setGroups: (g: CleanGroup[] | null) => void;
    selected: Set<string>;
    setSelected: (s: Set<string>) => void;
  };
}

export const StoreCtx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(StoreCtx);

export const itemKey = (cat: string, path: string) => `${cat}|${path}`;

export function defaultSelection(groups: CleanGroup[]): Set<string> {
  const s = new Set<string>();
  for (const g of groups) {
    if (!g.defaultSelected || g.locked) continue;
    for (const i of g.items) if (!i.inUse) s.add(itemKey(g.id, i.path));
  }
  return s;
}

export function selectedTargets(groups: CleanGroup[], sel: Set<string>): CleanTarget[] {
  const out: CleanTarget[] = [];
  for (const g of groups) for (const i of g.items) if (sel.has(itemKey(g.id, i.path))) out.push({ category: g.id, path: i.path, size: i.size });
  return out;
}
