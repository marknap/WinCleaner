import { useEffect, useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, InstalledApp, Leftover, RecentUninstall, UninstallResult } from "../api";
import { Badge, Button, Card, Check, Icon, Search, Segmented, Spinner, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { bytes, cx, timeAgo } from "../util";

type Selected = { kind: "app"; app: InstalledApp } | { kind: "recent"; recent: RecentUninstall };

export default function Uninstaller() {
  const s = useStore();
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [recent, setRecent] = useState<RecentUninstall[]>([]);
  const [view, setView] = useState<"installed" | "recent">("installed");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "size" | "date">("name");
  const [cur, setCur] = useState<Selected | null>(null);
  const [running, setRunning] = useState(false);
  const [leftovers, setLeftovers] = useState<Leftover[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = () => {
    invoke<InstalledApp[]>("apps_list").then(setApps).catch((e) => s.toast(String(e), "err"));
    invoke<RecentUninstall[]>("recent_uninstalls").then(setRecent).catch(() => {});
  };
  useEffect(load, []);

  const list = useMemo(() => {
    const a = (apps ?? []).filter((x) => !q || `${x.name} ${x.publisher}`.toLowerCase().includes(q.toLowerCase()));
    if (sort === "size") a.sort((x, y) => y.size - x.size);
    else if (sort === "date") a.sort((x, y) => y.installDate.localeCompare(x.installDate));
    return a;
  }, [apps, q, sort]);

  function pick(c: Selected) {
    setCur(c);
    setLeftovers(null);
    setMessage(null);
    setPreview(false);
  }

  function showLeftovers(l: Leftover[], isPreview: boolean) {
    setLeftovers(l);
    setPreview(isPreview);
    setSel(new Set(isPreview ? [] : l.filter((x) => !x.personal).map((x) => x.path)));
  }

  async function findLeftovers() {
    if (!cur) return;
    setRunning(true);
    try {
      if (cur.kind === "app") showLeftovers(await invoke<Leftover[]>("app_leftovers", { id: cur.app.id }), true);
      else showLeftovers(await invoke<Leftover[]>("recent_leftovers", { name: cur.recent.name }), false);
    } catch (e) {
      s.toast(String(e), "err");
    }
    setRunning(false);
  }

  async function uninstall() {
    if (cur?.kind !== "app") return;
    setRunning(true);
    try {
      const r = await invoke<UninstallResult>("app_uninstall", { id: cur.app.id });
      setMessage(r.message);
      showLeftovers(r.leftovers, false);
      s.toast(r.message, r.stillInstalled ? "info" : "ok");
      load();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setRunning(false);
  }

  async function removeLeftovers() {
    try {
      const r = await invoke<ActionResult>("leftovers_trash", { paths: [...sel] });
      s.toast(r.message, r.failed.length ? "info" : "ok");
      if (r.removed > 0) s.celebrate();
      s.refreshHistory();
      setLeftovers(null);
      setCur(null);
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  const date = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : "");
  const name = cur?.kind === "app" ? cur.app.name : cur?.recent.name ?? "";

  return (
    <div className="page">
      <ToolHeader icon="package" title={L("Uninstaller", "Verwijderen")} color="#ff6b8b" subtitle={L("Remove programs and the junk they leave behind.", "Verwijder programma's en de rommel die ze achterlaten.")}>
        <Button icon="refresh" onClick={load}>{L("Refresh", "Vernieuwen")}</Button>
      </ToolHeader>
      <div className="split">
        <div className="split-list">
          <div className="toolbar">
            <Segmented value={view} onChange={setView} options={[{ value: "installed", label: L("Installed", "Geïnstalleerd") }, { value: "recent", label: L(`Recently removed (${recent.length})`, `Recent verwijderd (${recent.length})`) }]} />
            {view === "installed" && <Segmented value={sort} onChange={setSort} options={[{ value: "name", label: "A-Z" }, { value: "size", label: L("Size", "Grootte") }, { value: "date", label: L("Newest", "Nieuwste") }]} />}
          </div>
          {view === "installed" && <Search value={q} onChange={setQ} placeholder={L(`Search ${apps?.length ?? ""} programs`, `Zoek in ${apps?.length ?? ""} programma's`)} />}
          {view === "installed" ? (!apps ? <div className="center-pad"><Spinner /></div> : (
            <div className="app-list">
              {list.map((a) => (
                <button key={a.id} className={cx("app-row", cur?.kind === "app" && cur.app.id === a.id && "active")} onClick={() => pick({ kind: "app", app: a })}>
                  <span className="app-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                  <span className="app-text">
                    <b className="ellipsis">{a.name}</b>
                    <span className="muted small ellipsis">{a.publisher || L("Unknown publisher", "Onbekende uitgever")}</span>
                  </span>
                  {a.isGame && <Badge tone="pink" icon="gamepad">Game</Badge>}
                  <span className="mono small muted">{a.size ? bytes(a.size) : ""}</span>
                </button>
              ))}
            </div>
          )) : (
            <div className="app-list">
              {!recent.length && <p className="muted center-pad">{L("Programs you uninstall with WinCleaner show up here, so you can check for leftovers later.", "Programma's die je met WinCleaner verwijdert verschijnen hier, zodat je later op restjes kunt controleren.")}</p>}
              {recent.map((r) => (
                <button key={r.name} className={cx("app-row", cur?.kind === "recent" && cur.recent.name === r.name && "active")} onClick={() => pick({ kind: "recent", recent: r })}>
                  <span className="app-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
                  <span className="app-text">
                    <b className="ellipsis">{r.name}</b>
                    <span className="muted small ellipsis">{L("Removed", "Verwijderd")} {timeAgo(r.date)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="split-detail">
          {!cur ? (
            <div className="placeholder"><Icon name="package" size={40} /><p>{L("Pick a program to see details.", "Kies een programma voor details.")}</p></div>
          ) : (
            <Card className="app-detail">
              <span className="app-avatar big">{name.slice(0, 1).toUpperCase()}</span>
              <h2>{name}</h2>
              {cur.kind === "app" && (
                <>
                  <p className="muted">{cur.app.publisher} {cur.app.version && `· v${cur.app.version}`}</p>
                  <dl>
                    <dt>{L("Size", "Grootte")}</dt><dd>{cur.app.size ? bytes(cur.app.size) : L("Unknown", "Onbekend")}</dd>
                    <dt>{L("Installed", "Geïnstalleerd")}</dt><dd>{date(cur.app.installDate) || L("Unknown", "Onbekend")}</dd>
                    <dt>{L("Location", "Locatie")}</dt><dd className="mono small ellipsis" title={cur.app.location}>{cur.app.location || L("Unknown", "Onbekend")}</dd>
                    <dt>{L("For", "Voor")}</dt><dd>{cur.app.machineWide ? L("All users", "Alle gebruikers") : L("Just you", "Alleen jou")}</dd>
                  </dl>
                </>
              )}
              {message && <p className="muted">{message}</p>}
              {(!leftovers || preview) && (
                <div className="row-actions">
                  {cur.kind === "app" && <Button kind="danger" icon="trash" disabled={running} onClick={uninstall}>{running ? L("Working...", "Bezig...") : L("Uninstall", "Verwijderen")}</Button>}
                  {!leftovers && <Button icon="search" disabled={running} onClick={findLeftovers}>{cur.kind === "app" ? L("Preview leftovers", "Restjes bekijken") : L("Find leftovers", "Restjes zoeken")}</Button>}
                </div>
              )}
              {cur.kind === "app" && !leftovers && <p className="muted small">{L("Uninstall starts the program's own uninstaller. Afterwards we look for folders and registry keys it left behind.", "Verwijderen start het eigen verwijderprogramma. Daarna zoeken we naar achtergebleven mappen en registersleutels.")}</p>}
              {leftovers && (
                <div className="leftover-box">
                  <h4>{leftovers.length ? (preview ? L("Likely leftovers after uninstall", "Waarschijnlijke restjes na verwijderen") : L("Leftovers found", "Restjes gevonden")) : L("No leftovers found. Clean exit!", "Geen restjes gevonden. Netjes!")}</h4>
                  {leftovers.map((l) => (
                    <div key={l.path} className="item-row">
                      {!preview && <Check state={sel.has(l.path)} onChange={(v) => { const n = new Set(sel); v ? n.add(l.path) : n.delete(l.path); setSel(n); }} />}
                      <Icon name={l.kind === "registry" ? "key" : "folder"} size={14} />
                      <span className="mono small ellipsis" title={l.path}>{l.path}</span>
                      {l.personal && <Badge tone="amber">{l.kind === "registry" ? L("Settings", "Instellingen") : L("May hold settings or saves", "Kan instellingen of saves bevatten")}</Badge>}
                      {l.kind === "folder" && <b className="mono">{bytes(l.size)}</b>}
                    </div>
                  ))}
                  {!preview && leftovers.length > 0 && (
                    <>
                      <p className="muted small">{L("Folders go to the Recycle Bin. Registry keys are backed up first, so you can put them back from History.", "Mappen gaan naar de Prullenbak. Registersleutels worden eerst geback-upt, zodat je ze via Geschiedenis kunt terugzetten.")}</p>
                      <Button kind="danger" icon="trash" disabled={!sel.size} onClick={removeLeftovers}>{L(`Remove ${sel.size} leftovers`, `${sel.size} restjes verwijderen`)}</Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
