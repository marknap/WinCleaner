import { useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, CleanGroup } from "../api";
import { ActionBar, Badge, Banner, Button, Check, Donut, EmptyStart, Icon, ScanProgress, Search, ToolHeader } from "../components";
import { defaultSelection, itemKey, selectedTargets, useStore } from "../store";
import { bytes, cx } from "../util";

const GROUPS: { id: CleanGroup["group"]; label: string; color: string }[] = [
  { id: "gaming", label: "Gaming", color: "#ff2bd6" },
  { id: "windows", label: "Windows", color: "#00f0ff" },
  { id: "browsers", label: "Browsers", color: "#ffc93c" },
  { id: "developer", label: "Developer", color: "#39ff88" },
];

export default function Clean() {
  const s = useStore();
  const { groups, setGroups, selected, setSelected } = s.clean;
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function scan() {
    setScanning(true);
    try {
      const g = await invoke<CleanGroup[]>("clean_scan", { onlyAuto: false });
      setGroups(g);
      setSelected(defaultSelection(g));
    } catch (e) {
      s.toast(String(e), "err");
    }
    setScanning(false);
  }

  async function clean() {
    if (!groups) return;
    setCleaning(true);
    try {
      const r = await invoke<ActionResult>("clean_run", { targets: selectedTargets(groups, selected), tool: "Clean" });
      s.toast(r.message, r.failed.length ? "info" : "ok");
      if (r.freed > 0) s.celebrate();
      s.refreshHistory();
      const g = await invoke<CleanGroup[]>("clean_scan", { onlyAuto: false });
      setGroups(g);
      setSelected(new Set());
    } catch (e) {
      s.toast(String(e), "err");
    }
    setCleaning(false);
  }

  const totals = useMemo(() => {
    const per: Record<string, { sel: number; total: number }> = {};
    for (const g of groups ?? []) {
      const p = (per[g.group] ??= { sel: 0, total: 0 });
      for (const i of g.items) {
        p.total += i.size;
        if (selected.has(itemKey(g.id, i.path))) p.sel += i.size;
      }
    }
    return per;
  }, [groups, selected]);

  const selBytes = Object.values(totals).reduce((a, t) => a + t.sel, 0);
  const selCount = selected.size;

  function setGroup(g: CleanGroup, on: boolean) {
    const next = new Set(selected);
    for (const i of g.items) {
      const k = itemKey(g.id, i.path);
      if (on) next.add(k);
      else next.delete(k);
    }
    setSelected(next);
  }

  function setItem(g: CleanGroup, path: string, on: boolean) {
    const next = new Set(selected);
    const k = itemKey(g.id, path);
    if (on) next.add(k);
    else next.delete(k);
    setSelected(next);
  }

  const showDev = s.prefs?.proMode || (groups ?? []).some((g) => g.group === "developer" && g.total > 0);

  return (
    <div className="page">
      <ToolHeader icon="sparkle" title="Clean" color="#39ff88" subtitle="Clear junk from Windows, launchers, browsers and your GPU.">
        {groups && !scanning && <Button icon="refresh" onClick={scan}>Rescan</Button>}
      </ToolHeader>

      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !groups ? (
        <EmptyStart icon="sparkle" color="#39ff88" title="Find junk to clear" text="Temp files, launcher caches, crash dumps, old driver installers and more. Nothing personal is touched." action="Scan for junk" onAction={scan} />
      ) : (
        <>
          {s.info && !s.info.isAdmin && groups.some((g) => g.locked) && (
            <Banner tone="cyan" icon="lock" action={<Button small icon="shield" onClick={s.restartAdmin}>Restart as admin</Button>}>
              A few system categories are locked. Restart as admin to clean them too.
            </Banner>
          )}
          <div className="clean-layout">
            <div className="clean-summary">
              <Donut size={220} parts={GROUPS.map((g) => ({ value: totals[g.id]?.sel ?? 0, color: g.color }))}>
                <span className="donut-big">{bytes(selBytes)}</span>
                <span className="muted small">selected</span>
              </Donut>
              <ul className="legend">
                {GROUPS.filter((g) => g.id !== "developer" || showDev).map((g) => (
                  <li key={g.id}>
                    <i style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
                    <span>{g.label}</span>
                    <b>{bytes(totals[g.id]?.sel ?? 0)}</b>
                  </li>
                ))}
              </ul>
              <p className="muted small center">
                Cleaned caches are {s.prefs?.cleanToRecycleBin ? "sent to the Recycle Bin" : "deleted right away to free space"}. Change this in Settings.
              </p>
            </div>

            <div className="clean-list">
              {GROUPS.filter((gr) => gr.id !== "developer" || showDev).map((gr) => {
                const list = groups.filter((g) => g.group === gr.id && (g.total > 0 || g.locked));
                if (!list.length) return null;
                return (
                  <section key={gr.id} className="cat-section">
                    <h4 style={{ color: gr.color }}>{gr.label}</h4>
                    {list.map((g) => {
                      const keys = g.items.map((i) => itemKey(g.id, i.path));
                      const n = keys.filter((k) => selected.has(k)).length;
                      const state = n === 0 ? false : n === keys.length ? true : "mixed";
                      const isOpen = open === g.id;
                      const items = g.items.filter((i) => !filter || i.path.toLowerCase().includes(filter.toLowerCase()));
                      return (
                        <div key={g.id} className={cx("cat", isOpen && "open", g.locked && "locked")}>
                          <div className="cat-row" onClick={() => !g.locked && setOpen(isOpen ? null : g.id)}>
                            <Check state={state} disabled={g.locked || !g.items.length} onChange={(v) => setGroup(g, v)} />
                            <div className="cat-text">
                              <div className="cat-name">
                                {g.name}
                                {g.locked && <Badge icon="lock" tone="cyan">Admin</Badge>}
                                {g.inUse && <Badge tone="amber">App running</Badge>}
                                {!g.defaultSelected && <Badge tone="pink">Optional</Badge>}
                              </div>
                              <p>{g.detail}</p>
                              {g.warning && <p className="warn"><Icon name="info" size={13} /> {g.warning}</p>}
                            </div>
                            <b className="cat-size mono">{g.locked ? "--" : bytes(g.total)}</b>
                            {!g.locked && <Icon name="chevronDown" size={18} className="chev" />}
                          </div>
                          {isOpen && (
                            <div className="cat-items">
                              {g.items.length > 8 && <Search value={filter} onChange={setFilter} placeholder="Filter files" />}
                              {g.inUse && <p className="warn small"><Icon name="alert" size={13} /> Close the app first to clean these safely. They're unticked for you.</p>}
                              {items.slice(0, 300).map((i) => (
                                <div key={i.path} className="item-row">
                                  <Check state={selected.has(itemKey(g.id, i.path))} onChange={(v) => setItem(g, i.path, v)} />
                                  <span className="mono ellipsis" title={i.path}>{i.path === "::recyclebin" ? `Recycle Bin (${i.name})` : i.path}</span>
                                  {i.inUse && <Badge tone="amber">In use</Badge>}
                                  <b className="mono">{bytes(i.size)}</b>
                                </div>
                              ))}
                              {items.length > 300 && <p className="muted small">+ {items.length - 300} more</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
          <ActionBar note={selCount ? `${selCount.toLocaleString()} items selected` : "Pick what to clean"}>
            <Button kind="primary" icon="sparkle" disabled={!selCount || cleaning} onClick={clean}>
              {cleaning ? "Cleaning..." : `Clean ${bytes(selBytes)}`}
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
