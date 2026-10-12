import { useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, FileEntry } from "../api";
import { ActionBar, Button, Check, EmptyStart, ScanProgress, Search, Segmented, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { bytes, timeAgo } from "../util";

type Mode = "large" | "old" | "installers" | "clips";
const INSTALLER = /\.(exe|msi|zip|rar|7z|iso|img)$/i;
const VIDEO = /\.(mp4|mkv|mov|webm|avi|flv)$/i;

let cache: FileEntry[] | null = null;

export default function BigFiles() {
  const s = useStore();
  const [files, setFiles] = useState<FileEntry[] | null>(cache);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<Mode>((s.bigFilesMode as Mode) ?? "large");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const minBytes = (s.prefs?.largeMinMb ?? 500) * 1024 * 1024;
  const oldDays = s.prefs?.oldDays ?? 180;

  async function scan() {
    setScanning(true);
    try {
      cache = await invoke<FileEntry[]>("large_scan");
      setFiles(cache);
      setSel(new Set());
    } catch (e) {
      s.toast(String(e), "err");
    }
    setScanning(false);
  }

  const visible = useMemo(() => {
    const cutoff = Date.now() / 1000 - oldDays * 86400;
    return (files ?? []).filter((f) => {
      if (q && !f.path.toLowerCase().includes(q.toLowerCase())) return false;
      if (mode === "large") return f.size >= minBytes;
      if (mode === "old") return f.modified < cutoff;
      if (mode === "clips") return VIDEO.test(f.name) && /\\videos\\/i.test(f.path);
      return INSTALLER.test(f.name) && /\\downloads\\/i.test(f.path);
    });
  }, [files, mode, q, minBytes, oldDays]);

  async function trash() {
    setBusy(true);
    try {
      const r = await invoke<ActionResult>("files_trash", { paths: [...sel] });
      s.toast(r.message, r.failed.length ? "info" : "ok");
      if (r.freed > 0) s.celebrate();
      cache = (files ?? []).filter((f) => !sel.has(f.path) || r.failed.some((x) => x.includes(f.path)));
      setFiles(cache);
      setSel(new Set());
      s.refreshHistory();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(false);
  }

  const selSize = (files ?? []).filter((f) => sel.has(f.path)).reduce((a, f) => a + f.size, 0);
  const allOn = visible.length > 0 && visible.every((f) => sel.has(f.path));

  return (
    <div className="page">
      <ToolHeader icon="file" title={L("Big Files", "Grote bestanden")} color="#ffb020" subtitle={L("Huge, forgotten files in Downloads, Desktop, Documents, Videos, Music and Pictures.", "Grote, vergeten bestanden in Downloads, Bureaublad, Documenten, Video's, Muziek en Afbeeldingen.")}>
        {files && !scanning && <Button icon="refresh" onClick={scan}>{L("Rescan", "Opnieuw scannen")}</Button>}
      </ToolHeader>
      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !files ? (
        <EmptyStart icon="file" color="#ffb020" title={L("Find space hogs", "Zoek ruimtevreters")}
          text={L("Old ISOs, game installers, recordings and archives you forgot about. Nothing is selected until you choose.", "Oude ISO's, game-installers, opnames en archieven die je vergeten bent. Er wordt niets geselecteerd tot jij kiest.")}
          action={L("Scan my folders", "Mijn mappen scannen")} onAction={scan} />
      ) : (
        <>
          <div className="toolbar">
            <Segmented value={mode} onChange={setMode} options={[
              { value: "large", label: L(`Over ${bytes(minBytes, 0)}`, `Boven ${bytes(minBytes, 0)}`) },
              { value: "old", label: L(`Untouched ${oldDays}+ days`, `${oldDays}+ dagen ongebruikt`) },
              { value: "installers", label: L("Old installers", "Oude installers") },
              { value: "clips", label: L("Game clips", "Gameclips") },
            ]} />
            <Search value={q} onChange={setQ} placeholder={L("Filter", "Filteren")} />
          </div>
          <div className="table-wrap">
            <table className="file-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><Check state={allOn} onChange={(v) => setSel(v ? new Set(visible.map((f) => f.path)) : new Set())} /></th>
                  <th>{L("Name", "Naam")}</th><th>{L("Folder", "Map")}</th><th>{L("Size", "Grootte")}</th><th>{L("Modified", "Gewijzigd")}</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 500).map((f) => (
                  <tr key={f.path} className={sel.has(f.path) ? "sel" : ""}>
                    <td><Check state={sel.has(f.path)} onChange={(v) => { const n = new Set(sel); v ? n.add(f.path) : n.delete(f.path); setSel(n); }} /></td>
                    <td className="ellipsis" title={f.name}><b>{f.name}</b></td>
                    <td className="ellipsis mono muted small" title={f.folder}>{f.folder}</td>
                    <td className="mono">{bytes(f.size)}</td>
                    <td className="muted small">{timeAgo(f.modified)}</td>
                    <td><Button small kind="subtle" icon="folder" title={L("Show in Explorer", "Tonen in Verkenner")} onClick={() => invoke("reveal", { path: f.path })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p className="muted center-pad">{L("Nothing here. Nice and tidy.", "Niets te zien. Lekker opgeruimd.")}</p>}
          </div>
          <ActionBar note={L(`${visible.length} files · everything goes to the Recycle Bin`, `${visible.length} bestanden · alles gaat naar de Prullenbak`)}>
            <Button kind="danger" icon="trash" disabled={!sel.size || busy} onClick={trash}>{L(`Recycle ${sel.size} (${bytes(selSize)})`, `${sel.size} naar Prullenbak (${bytes(selSize)})`)}</Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
