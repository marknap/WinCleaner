import { useEffect, useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, InstalledApp, UninstallResult } from "../api";
import { Badge, Button, Card, Check, Icon, Search, Segmented, Spinner, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, cx } from "../util";

export default function Uninstaller() {
  const s = useStore();
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "size" | "date">("name");
  const [cur, setCur] = useState<InstalledApp | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UninstallResult | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = () => invoke<InstalledApp[]>("apps_list").then(setApps).catch((e) => s.toast(String(e), "err"));
  useEffect(() => {
    load();
  }, []);

  const list = useMemo(() => {
    const a = (apps ?? []).filter((x) => !q || `${x.name} ${x.publisher}`.toLowerCase().includes(q.toLowerCase()));
    if (sort === "size") a.sort((x, y) => y.size - x.size);
    else if (sort === "date") a.sort((x, y) => y.installDate.localeCompare(x.installDate));
    return a;
  }, [apps, q, sort]);

  async function uninstall() {
    if (!cur) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await invoke<UninstallResult>("app_uninstall", { id: cur.id });
      setResult(r);
      setSel(new Set(r.leftovers.filter((l) => !l.personal).map((l) => l.path)));
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
      if (r.freed > 0) s.celebrate();
      s.refreshHistory();
      setResult(null);
      setCur(null);
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  const date = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : "");

  return (
    <div className="page">
      <ToolHeader icon="package" title="Uninstaller" color="#ff6b8b" subtitle="Remove programs and the junk they leave behind." >
        <Button icon="refresh" onClick={load}>Refresh</Button>
      </ToolHeader>
      <div className="split">
        <div className="split-list">
          <div className="toolbar">
            <Search value={q} onChange={setQ} placeholder={`Search ${apps?.length ?? ""} programs`} />
            <Segmented value={sort} onChange={setSort} options={[{ value: "name", label: "A-Z" }, { value: "size", label: "Size" }, { value: "date", label: "Newest" }]} />
          </div>
          {!apps ? <div className="center-pad"><Spinner /></div> : (
            <div className="app-list">
              {list.map((a) => (
                <button key={a.id} className={cx("app-row", cur?.id === a.id && "active")} onClick={() => { setCur(a); setResult(null); }}>
                  <span className="app-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                  <span className="app-text">
                    <b className="ellipsis">{a.name}</b>
                    <span className="muted small ellipsis">{a.publisher || "Unknown publisher"}</span>
                  </span>
                  {a.isGame && <Badge tone="pink" icon="gamepad">Game</Badge>}
                  <span className="mono small muted">{a.size ? bytes(a.size) : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="split-detail">
          {!cur ? (
            <div className="placeholder"><Icon name="package" size={40} /><p>Pick a program to see details.</p></div>
          ) : (
            <Card className="app-detail">
              <span className="app-avatar big">{cur.name.slice(0, 1).toUpperCase()}</span>
              <h2>{cur.name}</h2>
              <p className="muted">{cur.publisher} {cur.version && `· v${cur.version}`}</p>
              <dl>
                <dt>Size</dt><dd>{cur.size ? bytes(cur.size) : "Unknown"}</dd>
                <dt>Installed</dt><dd>{date(cur.installDate) || "Unknown"}</dd>
                <dt>Location</dt><dd className="mono small ellipsis" title={cur.location}>{cur.location || "Unknown"}</dd>
                <dt>For</dt><dd>{cur.machineWide ? "All users" : "Just you"}</dd>
              </dl>
              {!result && (
                <>
                  <p className="muted small">This starts the program's own uninstaller. Afterwards we look for folders it left behind.</p>
                  <Button kind="danger" icon="trash" disabled={running} onClick={uninstall}>{running ? "Waiting for the uninstaller..." : "Uninstall"}</Button>
                </>
              )}
              {result && (
                <div className="leftover-box">
                  <h4>{result.leftovers.length ? "Leftovers found" : "No leftovers found. Clean exit!"}</h4>
                  {result.leftovers.map((l) => (
                    <div key={l.path} className="item-row">
                      <Check state={sel.has(l.path)} onChange={(v) => { const n = new Set(sel); v ? n.add(l.path) : n.delete(l.path); setSel(n); }} />
                      <span className="mono small ellipsis" title={l.path}>{l.path}</span>
                      {l.personal && <Badge tone="amber">May hold settings or saves</Badge>}
                      <b className="mono">{bytes(l.size)}</b>
                    </div>
                  ))}
                  {result.leftovers.length > 0 && <Button kind="danger" icon="trash" disabled={!sel.size} onClick={removeLeftovers}>Recycle {sel.size} leftovers</Button>}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
