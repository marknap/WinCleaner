import { useEffect, useState } from "react";
import { invoke, pickFolder } from "../api";
import type { ActionResult, DupGroup } from "../api";
import { ActionBar, Badge, Button, Card, Check, EmptyStart, Icon, ScanProgress, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
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
      setGroups(groups.map((g) => ({ ...g, files: g.files.filter((f) => !sel.has(f.path)) })).filter((g) => g.files.length > 1));
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
      <ToolHeader icon="copy" title={L("Duplicates", "Duplicaten")} color="#b98cff"
        subtitle={groups ? L(`${groups.length} sets of identical files · ${bytes(wasted)} wasted`, `${groups.length} sets identieke bestanden · ${bytes(wasted)} verspild`) : L("Identical files, compared byte for byte.", "Identieke bestanden, byte voor byte vergeleken.")}>
        {groups && !scanning && <Button icon="refresh" onClick={scan}>{L("Rescan", "Opnieuw scannen")}</Button>}
      </ToolHeader>

      <div className="roots">
        {roots.map((r) => (
          <span key={r} className="chip">
            <Icon name="folder" size={14} /> <span className="mono">{r}</span>
            <button onClick={() => setRoots(roots.filter((x) => x !== r))} aria-label={L("Remove", "Verwijderen")}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <button className="chip add" onClick={add}><Icon name="plus" size={14} /> {L("Add folder", "Map toevoegen")}</button>
      </div>

      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !groups ? (
        <EmptyStart icon="copy" color="#b98cff" title={L("Find duplicate files", "Zoek dubbele bestanden")}
          text={L("Same screenshot saved three times? Same installer downloaded twice? The newest copy is always kept.", "Dezelfde screenshot drie keer opgeslagen? Dezelfde installer twee keer gedownload? De nieuwste kopie blijft altijd staan.")}
          action={L("Find duplicates", "Zoek duplicaten")} onAction={scan} />
      ) : groups.length === 0 ? (
        <p className="muted center-pad">{L("No duplicates found. Clean setup!", "Geen duplicaten gevonden. Strak!")}</p>
      ) : (
        <>
          <div className="dup-list">
            {groups.slice(0, 200).map((g) => (
              <Card key={g.id} className="dup">
                <div className="dup-head">
                  <b className="ellipsis">{g.files[0].name}</b>
                  <span className="muted small">{L(`${g.files.length} copies · ${bytes(g.size)} each`, `${g.files.length} kopieën · ${bytes(g.size)} per stuk`)}</span>
                </div>
                {g.files.map((f) => {
                  const on = sel.has(f.path);
                  const keepCount = g.files.filter((x) => !sel.has(x.path)).length;
                  return (
                    <div key={f.path} className="item-row">
                      <Check state={on} onChange={(v) => {
                        if (v && keepCount <= 1) return s.toast(L("At least one copy is always kept.", "Er blijft altijd minstens één kopie staan."), "info");
                        const n = new Set(sel);
                        v ? n.add(f.path) : n.delete(f.path);
                        setSel(n);
                      }} />
                      <span className="mono ellipsis small" title={f.path}>{f.folder}</span>
                      {!on && <Badge tone="lime">{L("Keep", "Bewaren")}</Badge>}
                      <span className="muted small">{timeAgo(f.modified)}</span>
                      <Button small kind="subtle" icon="folder" onClick={() => invoke("reveal", { path: f.path })} />
                    </div>
                  );
                })}
              </Card>
            ))}
          </div>
          <ActionBar note={L("Ticked copies go to the Recycle Bin", "Aangevinkte kopieën gaan naar de Prullenbak")}>
            <Button kind="danger" icon="trash" disabled={!sel.size || busy} onClick={trash}>{L(`Recycle ${sel.size} (${bytes(selSize)})`, `${sel.size} naar Prullenbak (${bytes(selSize)})`)}</Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
