import { useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, CleanGroup } from "../api";
import { ActionBar, Badge, Banner, Button, Check, Donut, EmptyStart, Icon, ScanProgress, Search, ToolHeader } from "../components";
import { defaultSelection, itemKey, selectedTargets, useStore } from "../store";
import { L } from "../i18n";
import { bytes, cx, num } from "../util";

const GROUPS: { id: CleanGroup["group"]; label: () => string; color: string }[] = [
  { id: "gaming", label: () => "Gaming", color: "#ff2bd6" },
  { id: "windows", label: () => "Windows", color: "#00f0ff" },
  { id: "browsers", label: () => "Browsers", color: "#ffc93c" },
  { id: "developer", label: () => L("Developer", "Ontwikkelaar"), color: "#39ff88" },
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
    const targets = selectedTargets(groups, selected);
    if (!(await s.confirmPermanent(targets))) return;
    setCleaning(true);
    try {
      const r = await invoke<ActionResult>("clean_run", { targets, tool: "clean" });
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
      <ToolHeader icon="sparkle" title={L("Clean", "Opschonen")} color="#39ff88" subtitle={L("Clear junk from Windows, launchers, browsers and your GPU.", "Ruim rommel op uit Windows, launchers, browsers en je GPU.")}>
        {groups && !scanning && <Button icon="refresh" onClick={scan}>{L("Rescan", "Opnieuw scannen")}</Button>}
      </ToolHeader>

      {scanning ? (
        <ScanProgress progress={s.progress} onCancel={() => invoke("cancel_job")} />
      ) : !groups ? (
        <EmptyStart
          icon="sparkle" color="#39ff88" title={L("Find junk to clear", "Zoek rommel om op te ruimen")}
          text={L("Temp files, launcher caches, crash dumps, old driver installers and more. Nothing personal is touched.", "Tijdelijke bestanden, launcher-caches, crashdumps, oude driverinstallaties en meer. Niets persoonlijks wordt aangeraakt.")}
          action={L("Scan for junk", "Scan op rommel")} onAction={scan}
        />
      ) : (
        <>
          {s.info && !s.info.isAdmin && groups.some((g) => g.locked) && (
            <Banner tone="cyan" icon="lock" action={<Button small icon="shield" onClick={s.restartAdmin}>{L("Restart as admin", "Herstart als beheerder")}</Button>}>
              {L("A few system categories are locked. Restart as admin to clean them too.", "Een paar systeemcategorieën zijn vergrendeld. Herstart als beheerder om die ook op te schonen.")}
            </Banner>
          )}
          <div className="clean-layout">
            <div className="clean-summary">
              <Donut size={220} parts={GROUPS.map((g) => ({ value: totals[g.id]?.sel ?? 0, color: g.color }))}>
                <span className="donut-big">{bytes(selBytes)}</span>
                <span className="muted small">{L("selected", "geselecteerd")}</span>
              </Donut>
              <ul className="legend">
                {GROUPS.filter((g) => g.id !== "developer" || showDev).map((g) => (
                  <li key={g.id}>
                    <i style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
                    <span>{g.label()}</span>
                    <b>{bytes(totals[g.id]?.sel ?? 0)}</b>
                  </li>
                ))}
              </ul>
              <p className="muted small center">
                {s.prefs?.cleanToRecycleBin
                  ? L("Cleaned caches go to the Recycle Bin. Change this in Settings.", "Opgeschoonde caches gaan naar de Prullenbak. Wijzig dit in Instellingen.")
                  : L("Cleaned caches are deleted right away to free space. Change this in Settings.", "Opgeschoonde caches worden direct verwijderd om ruimte vrij te maken. Wijzig dit in Instellingen.")}
              </p>
            </div>

            <div className="clean-list">
              {GROUPS.filter((gr) => gr.id !== "developer" || showDev).map((gr) => {
                const list = groups.filter((g) => g.group === gr.id && (g.total > 0 || g.locked));
                if (!list.length) return null;
                return (
                  <section key={gr.id} className="cat-section">
                    <h4 style={{ color: gr.color }}>{gr.label()}</h4>
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
                                {g.locked && <Badge icon="lock" tone="cyan">{L("Admin", "Beheerder")}</Badge>}
                                {g.inUse && <Badge tone="amber">{L("App running", "App draait")}</Badge>}
                                {!g.defaultSelected && <Badge tone="pink">{L("Optional", "Optioneel")}</Badge>}
                              </div>
                              <p>{g.detail}</p>
                              {g.warning && <p className="warn"><Icon name="info" size={13} /> {g.warning}</p>}
                            </div>
                            <b className="cat-size mono">{g.locked ? "--" : bytes(g.total)}</b>
                            {!g.locked && <Icon name="chevronDown" size={18} className="chev" />}
                          </div>
                          {isOpen && (
                            <div className="cat-items">
                              {g.items.length > 8 && <Search value={filter} onChange={setFilter} placeholder={L("Filter files", "Bestanden filteren")} />}
                              {g.inUse && <p className="warn small"><Icon name="alert" size={13} /> {L("Close the app first to clean these safely. They're unticked for you.", "Sluit eerst de app om dit veilig op te schonen. Ze zijn alvast uitgevinkt.")}</p>}
                              {items.slice(0, 300).map((i) => (
                                <div key={i.path} className="item-row">
                                  <Check state={selected.has(itemKey(g.id, i.path))} onChange={(v) => setItem(g, i.path, v)} />
                                  <span className="mono ellipsis" title={i.path}>{i.path === "::recyclebin" ? `${L("Recycle Bin", "Prullenbak")} (${i.name})` : i.path}</span>
                                  {i.inUse && <Badge tone="amber">{L("In use", "In gebruik")}</Badge>}
                                  <b className="mono">{bytes(i.size)}</b>
                                </div>
                              ))}
                              {items.length > 300 && <p className="muted small">+ {num(items.length - 300)} {L("more", "meer")}</p>}
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
          <ActionBar note={selCount ? L(`${num(selCount)} items selected`, `${num(selCount)} items geselecteerd`) : L("Pick what to clean", "Kies wat je wilt opschonen")}>
            <Button kind="primary" icon="sparkle" disabled={!selCount || cleaning} onClick={clean}>
              {cleaning ? L("Cleaning...", "Opschonen...") : L(`Clean ${bytes(selBytes)}`, `${bytes(selBytes)} opschonen`)}
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
