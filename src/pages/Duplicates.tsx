import { useEffect, useState } from "react";
import { invoke, pickFolder } from "../api";
import type { ActionResult, DupGroup } from "../api";
import { ActionBar, Badge, Button, Card, Check, EmptyStart, Icon, ScanProgress, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, timeAgo } from "../util";

export default function Duplicates() {
  const s = useStore();
  const [roots, setRoots] = useState<string[]>([]);
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<string[]>("dup_default_roots").then(setRoots);
  }, []);

  async function scan() {
    setScanning(true);
    try {
      const g = await invoke<DupGroup[]>("dup_scan", { roots });
      setGroups(g);
      // Everything except the newest copy in each group.
      setSel(new Set(g.flatMap((x) => x.files.filter((f) => !f.keep).map((f) => f.path))));
    } catch (e) {
      s.toast(String(e), "err");
    }
    setScanning(false);
  }

  async function add() {
    const p = await pickFolder();
    if (p && !roots.includes(p)) setRoots([...roots, p]);
  }

  async function trash() {
    if (!groups) return;
    setBusy(true);
    try {
      const r = await invoke<ActionResult>("dup_trash", { groups: groups.map((g) => g.files.map((f) => f.path)), selected: [...sel] });
      s.toast(r.message, r.failed.length ? "info" : "ok");
      if (r.freed > 0) s.celebrate();
      s.refreshHistory();
      const left = groups.map((g) => ({ ...g, files: g.files.filter((f) => !sel.has(f.path)) })).filter((g) => g.files.length > 1);
      setGroups(left);
      setSel(new Set());
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(false);
  }

  const selSize = (groups ?? []).reduce((a, g) => a + g.files.filter((f) => sel.has(f.path)).length * g.size, 0);
  const wasted = (groups ?? []).reduce((a, g) => a + g.wasted, 0);

  return (
    <div className="page">
      <ToolHeader icon="copy" title="Duplicates" color="#b98cff" subtitle={groups ? `${groups.length} sets of identical files · ${bytes(wasted)} wasted` : "Identical files, compared byte for byte."}>
        {groups && !scanning && <Button icon="refresh" onClick={scan}>Rescan</Button>}
      </ToolHeader>

      <div className="roots">
        {roots.map((r) => (
          <span key={r} className="chip">
            <Icon name="folder" size={14} /> <span className="mono">{r}</span>
            <button onClick={() => setRoots(roots.filter((x) => x !== r))} aria-label="Remove"><Icon name="x" size={12} /></button>
          </span>
        ))}
        <button className="chip add" onClick={add}><Icon name="plus" size={14} /> Add folder</button>
      </div>

      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !groups ? (
        <EmptyStart icon="copy" color="#b98cff" title="Find duplicate files" text="Same screenshot saved three times? Same installer downloaded twice? The newest copy is always kept." action="Find duplicates" onAction={scan} />
      ) : groups.length === 0 ? (
        <p className="muted center-pad">No duplicates found. Clean setup!</p>
      ) : (
        <>
          <div className="dup-list">
            {groups.slice(0, 200).map((g) => (
              <Card key={g.id} className="dup">
                <div className="dup-head">
                  <b className="ellipsis">{g.files[0].name}</b>
                  <span className="muted small">{g.files.length} copies · {bytes(g.size)} each</span>
                </div>
                {g.files.map((f) => {
                  const on = sel.has(f.path);
                  const keepCount = g.files.filter((x) => !sel.has(x.path)).length;
                  return (
                    <div key={f.path} className="item-row">
                      <Check state={on} onChange={(v) => {
                        if (v && keepCount <= 1) return s.toast("At least one copy is always kept.", "info");
                        const n = new Set(sel);
                        v ? n.add(f.path) : n.delete(f.path);
                        setSel(n);
                      }} />
                      <span className="mono ellipsis small" title={f.path}>{f.folder}</span>
                      {!on && <Badge tone="lime">Keep</Badge>}
                      <span className="muted small">{timeAgo(f.modified)}</span>
                      <Button small kind="subtle" icon="folder" onClick={() => invoke("reveal", { path: f.path })} />
                    </div>
                  );
                })}
              </Card>
            ))}
          </div>
          <ActionBar note="Ticked copies go to the Recycle Bin">
            <Button kind="danger" icon="trash" disabled={!sel.size || busy} onClick={trash}>Recycle {sel.size} ({bytes(selSize)})</Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
