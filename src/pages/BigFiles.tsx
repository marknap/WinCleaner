import { useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, FileEntry } from "../api";
import { ActionBar, Button, Check, EmptyStart, ScanProgress, Search, Segmented, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, timeAgo } from "../util";

type Mode = "large" | "old" | "installers";
const INSTALLER = /\.(exe|msi|zip|rar|7z|iso|img)$/i;

let cache: FileEntry[] | null = null;

export default function BigFiles() {
  const s = useStore();
  const [files, setFiles] = useState<FileEntry[] | null>(cache);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<Mode>("large");
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
      <ToolHeader icon="file" title="Big Files" color="#ffb020" subtitle="Huge, forgotten files in Downloads, Desktop, Documents, Videos, Music and Pictures.">
        {files && !scanning && <Button icon="refresh" onClick={scan}>Rescan</Button>}
      </ToolHeader>
      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !files ? (
        <EmptyStart icon="file" color="#ffb020" title="Find space hogs" text="Old ISOs, game installers, recordings and archives you forgot about. Nothing is selected until you choose." action="Scan my folders" onAction={scan} />
      ) : (
        <>
          <div className="toolbar">
            <Segmented value={mode} onChange={setMode} options={[
              { value: "large", label: `Over ${bytes(minBytes, 0)}` },
              { value: "old", label: `Untouched ${oldDays}+ days` },
              { value: "installers", label: "Old installers" },
            ]} />
            <Search value={q} onChange={setQ} placeholder="Filter" />
          </div>
          <div className="table-wrap">
            <table className="file-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><Check state={allOn} onChange={(v) => setSel(v ? new Set(visible.map((f) => f.path)) : new Set())} /></th>
                  <th>Name</th><th>Folder</th><th>Size</th><th>Modified</th><th />
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
                    <td><Button small kind="subtle" icon="folder" title="Show in Explorer" onClick={() => invoke("reveal", { path: f.path })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p className="muted center-pad">Nothing here. Nice and tidy.</p>}
          </div>
          <ActionBar note={`${visible.length} files · everything goes to the Recycle Bin`}>
            <Button kind="danger" icon="trash" disabled={!sel.size || busy} onClick={trash}>Recycle {sel.size} ({bytes(selSize)})</Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
