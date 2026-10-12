import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, pickFolder } from "../api";
import type { ActionResult, ChildView, Drive, NodeView } from "../api";
import { Bar, Button, Card, EmptyStart, Icon, ScanProgress, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, cx } from "../util";

const KIND_COLORS: Record<string, string> = {
  folder: "#2f6bff", video: "#ff2bd6", image: "#b98cff", audio: "#ffb020", archive: "#c0703a",
  app: "#00c2a8", game: "#39ff88", doc: "#6b7cff", code: "#4ef2d0", other: "#56607f", bucket: "#2a3050",
};

const LEGEND: [string, string][] = [["folder", "Folders"], ["game", "Game data"], ["video", "Video"], ["image", "Images"], ["audio", "Audio"], ["archive", "Archives"], ["app", "Programs"], ["other", "Other"]];

interface Rect { x: number; y: number; w: number; h: number; c: ChildView }

/** Squarified treemap layout. */
function squarify(items: ChildView[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((a, i) => a + i.size, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const scale = (w * h) / total;
  const nodes = items.filter((i) => i.size > 0).map((c) => ({ c, a: c.size * scale }));
  const out: Rect[] = [];
  let row: typeof nodes = [];
  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((a, n) => a + n.a, 0);
    const max = Math.max(...r.map((n) => n.a));
    const min = Math.min(...r.map((n) => n.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const layout = (r: typeof nodes) => {
    const s = r.reduce((a, n) => a + n.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const n of r) {
        const ch = n.a / cw;
        out.push({ x, y: cy, w: cw, h: ch, c: n.c });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx2 = x;
      for (const n of r) {
        const cw = n.a / rh;
        out.push({ x: cx2, y, w: cw, h: rh, c: n.c });
        cx2 += cw;
      }
      y += rh;
      h -= rh;
    }
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else {
      layout(row);
      row = [n];
    }
  }
  if (row.length) layout(row);
  return out;
}

export default function DiskMap() {
  const s = useStore();
  const [drives, setDrives] = useState<Drive[]>([]);
  const [view, setView] = useState<NodeView | null>(null);
  const [scanning, setScanning] = useState(false);
  const [hover, setHover] = useState<ChildView | null>(null);
  const [picked, setPicked] = useState<ChildView | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  useEffect(() => {
    invoke<Drive[]>("drives").then(setDrives);
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [view]);

  async function scan(root: string) {
    setScanning(true);
    setPicked(null);
    try {
      setView(await invoke<NodeView>("analyze_scan", { root }));
    } catch (e) {
      s.toast(String(e), "err");
    }
    setScanning(false);
  }

  async function open(path: string) {
    try {
      setView(await invoke<NodeView>("analyze_open", { path }));
      setPicked(null);
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  async function trash(c: ChildView) {
    try {
      const r = await invoke<ActionResult>("analyze_trash", { path: c.path });
      if (r.removed) {
        s.toast(`Moved ${c.name} to the Recycle Bin`);
        s.refreshHistory();
        if (view) open(view.path);
      } else s.toast(r.failed[0] ?? "That one is protected.", "err");
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  const rects = useMemo(() => (view ? squarify(view.children, 0, 0, size.w, size.h) : []), [view, size]);
  const crumbs = useMemo(() => {
    if (!view) return [];
    const root = view.root.replace(/\\$/, "");
    const rel = view.path.replace(/\\$/, "").slice(root.length).split("\\").filter(Boolean);
    const out = [{ name: view.root, path: view.root }];
    let p = root;
    for (const r of rel) {
      p = `${p}\\${r}`;
      out.push({ name: r, path: p });
    }
    return out;
  }, [view]);

  const info = hover ?? picked;

  return (
    <div className="page">
      <ToolHeader icon="map" title="Disk Map" color="#00c2ff" subtitle="See what's eating your drives. Bigger block, bigger file." />
      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !view ? (
        <>
          <div className="drive-pick">
            {drives.map((d) => (
              <Card key={d.path} className="drive-tile" onClick={() => scan(d.path)}>
                <Icon name="disk" size={28} />
                <b>{d.path}</b>
                <span className="muted small">{d.name}</span>
                <Bar value={1 - d.free / d.total} color={d.free / d.total < 0.1 ? "var(--red)" : "var(--cyan)"} />
                <span className="small">{bytes(d.free, 0)} free of {bytes(d.total, 0)}</span>
              </Card>
            ))}
            <Card className="drive-tile" onClick={async () => { const p = await pickFolder(); if (p) scan(p); }}>
              <Icon name="folder" size={28} />
              <b>Pick a folder</b>
              <span className="muted small">Map just one folder</span>
            </Card>
          </div>
          {!drives.length && <EmptyStart icon="map" color="#00c2ff" title="Map a drive" text="Pick a drive to scan." action="Pick a folder" onAction={async () => { const p = await pickFolder(); if (p) scan(p); }} />}
        </>
      ) : (
        <>
          <div className="crumbs">
            <Button small icon="back" onClick={() => (crumbs.length > 1 ? open(crumbs[crumbs.length - 2].path) : setView(null))} />
            {crumbs.map((c, i) => (
              <button key={c.path} className={cx("crumb", i === crumbs.length - 1 && "cur")} onClick={() => open(c.path)}>{c.name}</button>
            ))}
            <span className="muted mono small">{bytes(view.size)}</span>
          </div>
          <div className="map-layout">
            <div className="treemap" ref={box} onMouseLeave={() => setHover(null)}>
              {rects.map((r) => (
                <div
                  key={r.c.path || r.c.name}
                  className={cx("tile", r.c.isDir && "dir", picked?.path === r.c.path && "picked")}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, "--c": KIND_COLORS[r.c.kind] } as React.CSSProperties}
                  onMouseEnter={() => setHover(r.c)}
                  onClick={() => (r.c.isDir ? open(r.c.path) : r.c.path && setPicked(r.c))}
                  onContextMenu={(e) => { e.preventDefault(); if (r.c.path) setPicked(r.c); }}
                >
                  {r.w > 70 && r.h > 34 && (
                    <span className="tile-label">
                      <b className="ellipsis">{r.c.name}</b>
                      <span>{bytes(r.c.size)}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <Card className="map-side">
              {info ? (
                <>
                  <span className="eyebrow">{info.isDir ? "Folder" : info.kind === "bucket" ? "Small files" : "File"}</span>
                  <h3 className="ellipsis" title={info.name}>{info.name}</h3>
                  <b className="text-cyan mono big">{bytes(info.size)}</b>
                  <p className="mono small muted break">{info.path}</p>
                  {info.path && picked?.path === info.path && (
                    <div className="map-actions">
                      <Button small icon="folder" onClick={() => invoke("reveal", { path: info.path })}>Show in Explorer</Button>
                      <Button small kind="danger" icon="trash" onClick={() => trash(info)}>Recycle</Button>
                    </div>
                  )}
                  {info.path && picked?.path !== info.path && <p className="muted small">Right-click a block to act on it.</p>}
                </>
              ) : (
                <p className="muted">Hover a block for details. Click folders to dive in, right-click to act.</p>
              )}
              <ul className="legend small">
                {LEGEND.map(([k, l]) => <li key={k}><i style={{ background: KIND_COLORS[k] }} /> <span>{l}</span></li>)}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
