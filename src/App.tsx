import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { invoke, onEvent, windowAction } from "./api";
import type { CleanGroup, CleanTarget, HistoryFile, Prefs, Progress, SysInfo } from "./api";
import { Burst, Icon, IconName, Modal } from "./components";
import { AskOptions, Page, Store, StoreCtx } from "./store";
import { L, setLang } from "./i18n";
import { ACHIEVEMENTS, unlocked } from "./achievements";
import { checkForUpdate, installUpdate } from "./updater";
import { bytes, cx, rankName, rankOf, xpOf } from "./util";
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

type Nav = { id: Page; label: () => string; icon: IconName; color: string };

const MAIN: Nav[] = [
  { id: "home", label: () => L("Home", "Home"), icon: "home", color: "#00f0ff" },
  { id: "clean", label: () => L("Clean", "Opschonen"), icon: "sparkle", color: "#39ff88" },
  { id: "boost", label: () => "Game Boost", icon: "rocket", color: "#ff2bd6" },
  { id: "games", label: () => L("My Games", "Mijn games"), icon: "gamepad", color: "#ffc93c" },
  { id: "startup", label: () => L("Startup", "Opstarten"), icon: "power", color: "#7aa8ff" },
  { id: "performance", label: () => L("Performance", "Prestaties"), icon: "gauge", color: "#4ef2d0" },
];

const PRO: Nav[] = [
  { id: "bigfiles", label: () => L("Big Files", "Grote bestanden"), icon: "file", color: "#ffb020" },
  { id: "duplicates", label: () => L("Duplicates", "Duplicaten"), icon: "copy", color: "#b98cff" },
  { id: "uninstaller", label: () => L("Uninstaller", "Verwijderen"), icon: "package", color: "#ff6b8b" },
  { id: "diskmap", label: () => L("Disk Map", "Schijfkaart"), icon: "map", color: "#00c2ff" },
  { id: "history", label: () => L("History", "Geschiedenis"), icon: "history", color: "#8a93b8" },
];

interface Toast { id: number; msg: string; kind: "ok" | "err" | "info" }
interface Asking extends AskOptions { resolve: (v: string | null) => void }

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
  const [asking, setAsking] = useState<Asking | null>(null);
  const [bigFilesMode, setBigFilesMode] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);
  const prefsRef = useRef<Prefs | null>(null);
  prefsRef.current = prefs;

  const refreshHistory = useCallback(() => {
    invoke<HistoryFile>("history_get").then(setHistory).catch(() => {});
  }, []);

  const loadInfo = useCallback(async () => {
    const i = await invoke<SysInfo>("system_info");
    setLang(i.language);
    setInfo(i);
  }, []);

  useEffect(() => {
    loadInfo();
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
    const t = setTimeout(() => checkForUpdate().then(setUpdate).catch(() => {}), 4000);
    const onFound = (e: Event) => setUpdate((e as CustomEvent<Update>).detail);
    window.addEventListener("update-found", onFound);
    return () => {
      un1();
      un2();
      clearTimeout(t);
      window.removeEventListener("update-found", onFound);
    };
  }, [refreshHistory, loadInfo]);

  useEffect(() => {
    if (prefs) setProOpen(prefs.proMode);
  }, [prefs?.proMode]);

  const toast = useCallback((msg: string, kind: "ok" | "err" | "info" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const savePrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      const cur = prefsRef.current;
      if (!cur) return;
      try {
        const p = await invoke<Prefs>("set_prefs", { p: { ...cur, ...patch } });
        setPrefs(p);
        if (patch.language) await loadInfo();
      } catch (e) {
        toast(String(e), "err");
      }
    },
    [toast, loadInfo],
  );

  // Achievement unlocks.
  useEffect(() => {
    if (!history || !prefs) return;
    const ids = unlocked(history);
    const fresh = ids.filter((id) => !prefs.achievementsSeen.includes(id));
    if (!fresh.length) return;
    if (fresh.length <= 2) {
      for (const id of fresh) {
        const a = ACHIEVEMENTS.find((x) => x.id === id)!;
        toast(L(`Achievement unlocked: ${a.name()}`, `Prestatie ontgrendeld: ${a.name()}`));
      }
    } else {
      toast(L(`${fresh.length} achievements unlocked! See History.`, `${fresh.length} prestaties ontgrendeld! Zie Geschiedenis.`));
    }
    setBurst(Date.now());
    savePrefs({ achievementsSeen: ids });
  }, [history, prefs?.achievementsSeen]);

  const go = useCallback((p: Page, opts?: { bigFilesMode?: string }) => {
    setProgress(null);
    setBigFilesMode(opts?.bigFilesMode ?? null);
    setPage(p);
    if (PRO.some((x) => x.id === p)) setProOpen(true);
  }, []);

  const ask = useCallback((o: AskOptions) => new Promise<string | null>((resolve) => setAsking({ ...o, resolve })), []);

  const confirmPermanent = useCallback(
    async (targets: CleanTarget[]) => {
      const p = prefsRef.current;
      if (!p || p.cleanToRecycleBin || p.confirmedPermanent) return true;
      const permanent = targets.filter((t) => !["recyclebin", "hibernation", "windowsold"].includes(t.category));
      if (!permanent.length) return true;
      const total = permanent.reduce((a, t) => a + t.size, 0);
      const r = await ask({
        title: L("Quick heads-up", "Even ter info"),
        icon: "info",
        body: (
          <>
            <p>{L(`Caches and temp files (${bytes(total)}) are deleted right away, so the space is freed immediately.`, `Caches en tijdelijke bestanden (${bytes(total)}) worden direct verwijderd, zodat de ruimte meteen vrijkomt.`)}</p>
            <p className="muted">{L("They aren't personal files: apps and games rebuild them when needed. Your saves, documents and photos are never touched.", "Het zijn geen persoonlijke bestanden: apps en games maken ze opnieuw aan als dat nodig is. Je saves, documenten en foto's worden nooit aangeraakt.")}</p>
          </>
        ),
        buttons: [
          { id: "cancel", label: L("Cancel", "Annuleren"), kind: "subtle" },
          { id: "bin", label: L("Use the Recycle Bin instead", "Liever via de Prullenbak") },
          { id: "ok", label: L("Got it, clean", "Begrepen, opschonen"), kind: "primary" },
        ],
      });
      if (r === "ok") await savePrefs({ confirmedPermanent: true });
      else if (r === "bin") await savePrefs({ cleanToRecycleBin: true, confirmedPermanent: true });
      return r === "ok" || r === "bin";
    },
    [ask, savePrefs],
  );

  async function doUpdate() {
    if (!update) return;
    setUpdating(0);
    try {
      await installUpdate(update, setUpdating);
    } catch (e) {
      toast(String(e), "err");
      setUpdating(null);
    }
  }

  const store: Store = useMemo(
    () => ({
      info, refreshInfo: loadInfo, prefs, savePrefs, page, go, toast, progress, history, refreshHistory, ask, confirmPermanent, bigFilesMode,
      celebrate: () => setBurst(Date.now()),
      restartAdmin: () => invoke("relaunch_admin").catch((e) => toast(String(e), "err")),
      clean: { groups, setGroups, selected, setSelected },
    }),
    [info, loadInfo, prefs, savePrefs, page, go, toast, progress, history, refreshHistory, ask, confirmPermanent, bigFilesMode, groups, selected],
  );

  if (!info) return <div className="app" />;

  const rank = history ? rankOf(xpOf(history)) : null;
  const Screen = {
    home: Home, clean: Clean, boost: Boost, games: Games, startup: Startup, performance: Performance,
    bigfiles: BigFiles, duplicates: Duplicates, uninstaller: Uninstaller, diskmap: DiskMap, history: History, settings: Settings,
  }[page];

  return (
    <StoreCtx.Provider value={store}>
      <div className="app" key={info.language}>
        <div className="titlebar" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <img src="/logo.svg" alt="" width={20} height={20} />
            <b>WinCleaner</b>
            <span className="brand-tag">FOR GAMERS</span>
          </div>
          <div className="titlebar-mid" data-tauri-drag-region>
            {info.isAdmin && <span className="admin-pill"><Icon name="shield" size={12} /> {L("Admin", "Beheerder")}</span>}
            {update && (
              <button className="update-pill" onClick={doUpdate} disabled={updating !== null}>
                <Icon name="download" size={13} />
                {updating === null
                  ? L(`Update ${update.version} available. Install`, `Update ${update.version} beschikbaar. Installeren`)
                  : L(`Updating ${Math.round(updating * 100)}%`, `Bijwerken ${Math.round(updating * 100)}%`)}
              </button>
            )}
          </div>
          <div className="win-controls">
            <button onClick={() => windowAction("minimize")} aria-label={L("Minimize", "Minimaliseren")}><Icon name="minimize" size={14} /></button>
            <button onClick={() => windowAction("toggleMaximize")} aria-label={L("Maximize", "Maximaliseren")}><Icon name="maximize" size={12} /></button>
            <button className="close" onClick={() => windowAction("close")} aria-label={L("Close", "Sluiten")}><Icon name="x" size={14} /></button>
          </div>
        </div>

        <aside className="sidebar">
          <nav>
            {MAIN.map((m) => <NavItem key={m.id} {...m} active={page === m.id} onClick={() => go(m.id)} />)}
            <button className={cx("nav-section", proOpen && "open")} onClick={() => { setProOpen(!proOpen); savePrefs({ proMode: !proOpen }); }}>
              <Icon name="chevron" size={14} className="chev" />
              <span>{L("Pro tools", "Pro-tools")}</span>
            </button>
            {proOpen && PRO.map((m) => <NavItem key={m.id} {...m} active={page === m.id} onClick={() => go(m.id)} small />)}
          </nav>
          <div className="sidebar-foot">
            {rank && (
              <button className="rank-mini" onClick={() => go("history")} title={L("Your rank", "Jouw rang")}>
                <span className="rank-gem" style={{ "--c": rank.rank.color } as React.CSSProperties}><Icon name="trophy" size={14} /></span>
                <span className="rank-mini-text">
                  <b style={{ color: rank.rank.color }}>{rankName(rank.rank)}</b>
                  <span className="xp"><i style={{ width: `${rank.progress * 100}%`, background: rank.rank.color }} /></span>
                </span>
              </button>
            )}
            <NavItem id="settings" label={() => L("Settings", "Instellingen")} icon="settings" color="#8a93b8" active={page === "settings"} onClick={() => go("settings")} />
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
        {asking && (
          <Modal title={asking.title} icon={asking.icon} buttons={asking.buttons} onClose={(id) => { asking.resolve(id); setAsking(null); }}>
            {asking.body}
          </Modal>
        )}
        <Burst trigger={burst} />
      </div>
    </StoreCtx.Provider>
  );
}

function NavItem({ label, icon, color, active, onClick, small }: Nav & { active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button className={cx("nav-item", active && "active", small && "small")} style={{ "--c": color } as React.CSSProperties} onClick={onClick}>
      <Icon name={icon} size={small ? 17 : 20} />
      <span>{label()}</span>
    </button>
  );
}
