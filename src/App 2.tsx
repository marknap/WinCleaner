import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, onEvent, windowAction } from "./api";
import type { CleanGroup, HistoryFile, Prefs, Progress, SysInfo } from "./api";
import { Burst, Icon, IconName } from "./components";
import { Page, Store, StoreCtx } from "./store";
import { cx, rankOf, xpOf } from "./util";
import Home from "./pages/Home";
import Clean from "./pages/Clean";
import Boost from "./pages/Boost";
import Games from "./pages/Games";
import Startup from "./pages/Startup";
import Performance from "./pages/Performance";
import BigFiles from "./pages/BigFiles";
import Duplicates from "./pages/Duplicates";
import Uninstaller from "./pages/Uninstaller";
import DiskMap from "./pages/DiskMap";
import History from "./pages/History";
import Settings from "./pages/Settings";

const MAIN: { id: Page; label: string; icon: IconName; color: string }[] = [
  { id: "home", label: "Home", icon: "home", color: "#00f0ff" },
  { id: "clean", label: "Clean", icon: "sparkle", color: "#39ff88" },
  { id: "boost", label: "Game Boost", icon: "rocket", color: "#ff2bd6" },
  { id: "games", label: "My Games", icon: "gamepad", color: "#ffc93c" },
  { id: "startup", label: "Startup", icon: "power", color: "#7aa8ff" },
  { id: "performance", label: "Performance", icon: "gauge", color: "#4ef2d0" },
];

const PRO: { id: Page; label: string; icon: IconName; color: string }[] = [
  { id: "bigfiles", label: "Big Files", icon: "file", color: "#ffb020" },
  { id: "duplicates", label: "Duplicates", icon: "copy", color: "#b98cff" },
  { id: "uninstaller", label: "Uninstaller", icon: "package", color: "#ff6b8b" },
  { id: "diskmap", label: "Disk Map", icon: "map", color: "#00c2ff" },
  { id: "history", label: "History", icon: "history", color: "#8a93b8" },
];

interface Toast { id: number; msg: string; kind: "ok" | "err" | "info" }

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [info, setInfo] = useState<SysInfo | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [history, setHistory] = useState<HistoryFile | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [burst, setBurst] = useState(0);
  const [groups, setGroups] = useState<CleanGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proOpen, setProOpen] = useState(false);

  const refreshHistory = useCallback(() => {
    invoke<HistoryFile>("history_get").then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<SysInfo>("system_info").then(setInfo);
    invoke<Prefs>("get_prefs").then((p) => {
      setPrefs(p);
      setProOpen(p.proMode);
    });
    refreshHistory();
    const un1 = onEvent<Progress>("progress", setProgress);
    const un2 = onEvent<string>("tray", (a) => {
      if (a === "boost") setPage("boost");
      if (a === "quickclean") {
        setPage("home");
        window.dispatchEvent(new CustomEvent("quickclean"));
      }
    });
    return () => {
      un1();
      un2();
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (prefs) setProOpen(prefs.proMode);
  }, [prefs?.proMode]);

  const toast = useCallback((msg: string, kind: "ok" | "err" | "info" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const savePrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      if (!prefs) return;
      try {
        const p = await invoke<Prefs>("set_prefs", { p: { ...prefs, ...patch } });
        setPrefs(p);
      } catch (e) {
        toast(String(e), "err");
      }
    },
    [prefs, toast],
  );

  const go = useCallback((p: Page) => {
    setProgress(null);
    setPage(p);
    if (PRO.some((x) => x.id === p)) setProOpen(true);
  }, []);

  const store: Store = useMemo(
    () => ({
      info, prefs, savePrefs, page, go, toast, progress, history, refreshHistory,
      celebrate: () => setBurst(Date.now()),
      restartAdmin: () => invoke("relaunch_admin").catch((e) => toast(String(e), "err")),
      clean: { groups, setGroups, selected, setSelected },
    }),
    [info, prefs, savePrefs, page, go, toast, progress, history, refreshHistory, groups, selected],
  );

  const rank = history ? rankOf(xpOf(history)) : null;

  const Screen = {
    home: Home, clean: Clean, boost: Boost, games: Games, startup: Startup, performance: Performance,
    bigfiles: BigFiles, duplicates: Duplicates, uninstaller: Uninstaller, diskmap: DiskMap, history: History, settings: Settings,
  }[page];

  return (
    <StoreCtx.Provider value={store}>
      <div className="app">
        <div className="titlebar" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <img src="/logo.svg" alt="" width={20} height={20} />
            <b>WinCleaner</b>
            <span className="brand-tag">FOR GAMERS</span>
          </div>
          <div className="titlebar-mid" data-tauri-drag-region>
            {info?.isAdmin && <span className="admin-pill"><Icon name="shield" size={12} /> Admin</span>}
          </div>
          <div className="win-controls">
            <button onClick={() => windowAction("minimize")} aria-label="Minimize"><Icon name="minimize" size={14} /></button>
            <button onClick={() => windowAction("toggleMaximize")} aria-label="Maximize"><Icon name="maximize" size={12} /></button>
            <button className="close" onClick={() => windowAction("close")} aria-label="Close"><Icon name="x" size={14} /></button>
          </div>
        </div>

        <aside className="sidebar">
          <nav>
            {MAIN.map((m) => (
              <NavItem key={m.id} {...m} active={page === m.id} onClick={() => go(m.id)} />
            ))}
            <button className={cx("nav-section", proOpen && "open")} onClick={() => { setProOpen(!proOpen); savePrefs({ proMode: !proOpen }); }}>
              <Icon name="chevron" size={14} className="chev" />
              <span>Pro tools</span>
            </button>
            {proOpen && PRO.map((m) => <NavItem key={m.id} {...m} active={page === m.id} onClick={() => go(m.id)} small />)}
          </nav>
          <div className="sidebar-foot">
            {rank && (
              <button className="rank-mini" onClick={() => go("history")} title="Your rank">
                <span className="rank-gem" style={{ "--c": rank.rank.color } as React.CSSProperties}><Icon name="trophy" size={14} /></span>
                <span className="rank-mini-text">
                  <b style={{ color: rank.rank.color }}>{rank.rank.name}</b>
                  <span className="xp"><i style={{ width: `${rank.progress * 100}%`, background: rank.rank.color }} /></span>
                </span>
              </button>
            )}
            <NavItem id="settings" label="Settings" icon="settings" color="#8a93b8" active={page === "settings"} onClick={() => go("settings")} />
          </div>
        </aside>

        <main className="content" key={page}>
          <Screen />
        </main>

        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={cx("toast", `toast-${t.kind}`)}>
              <Icon name={t.kind === "err" ? "alert" : t.kind === "info" ? "info" : "check"} size={18} />
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
        <Burst trigger={burst} />
      </div>
    </StoreCtx.Provider>
  );
}

function NavItem({ label, icon, color, active, onClick, small }: { id: Page; label: string; icon: IconName; color: string; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button className={cx("nav-item", active && "active", small && "small")} style={{ "--c": color } as React.CSSProperties} onClick={onClick}>
      <Icon name={icon} size={small ? 17 : 20} />
      <span>{label}</span>
    </button>
  );
}
