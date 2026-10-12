import { useEffect, useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, Game, Library } from "../api";
import { ActionBar, Badge, Bar, Button, Card, Check, EmptyStart, Icon, Search, Segmented, Spinner, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, cx, timeAgo } from "../util";

const LAUNCHER: Record<string, { label: string; color: string }> = {
  steam: { label: "Steam", color: "#66c0f4" },
  epic: { label: "Epic", color: "#e8ecff" },
  gog: { label: "GOG", color: "#b98cff" },
};

const DUSTY_DAYS = 90;

export default function Games() {
  const s = useStore();
  const [lib, setLib] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"size" | "name" | "played">("size");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    invoke<Library>("games_list")
      .then(setLib)
      .catch((e) => s.toast(String(e), "err"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const games = useMemo(() => {
    const g = (lib?.games ?? []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
    if (sort === "name") g.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "played") g.sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0));
    else g.sort((a, b) => b.size - a.size);
    return g;
  }, [lib, sort, q]);

  const drives = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of lib?.games ?? []) m[g.drive] = (m[g.drive] ?? 0) + g.size;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [lib]);

  const total = (lib?.games ?? []).reduce((a, g) => a + g.size, 0);
  const dusty = (lib?.games ?? []).filter((g) => g.lastPlayed && Date.now() / 1000 - g.lastPlayed > DUSTY_DAYS * 86400);

  async function act(g: Game, action: "play" | "verify" | "uninstall") {
    try {
      await invoke("game_action", { launcher: g.launcher, id: g.id, action });
      if (action === "uninstall") s.toast(`Finish the uninstall in ${LAUNCHER[g.launcher].label}, then refresh.`, "info");
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  async function removeLeftovers() {
    setBusy(true);
    try {
      const r = await invoke<ActionResult>("game_leftovers_trash", { paths: [...sel] });
      s.toast(r.message || `Moved ${bytes(r.freed)} to the Recycle Bin`, r.failed.length ? "info" : "ok");
      if (r.freed > 0) s.celebrate();
      setSel(new Set());
      s.refreshHistory();
      load();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(false);
  }

  const selSize = (lib?.leftovers ?? []).filter((l) => sel.has(l.path)).reduce((a, l) => a + l.size, 0);

  return (
    <div className="page">
      <ToolHeader icon="gamepad" title="My Games" color="#ffc93c" subtitle="Every installed game across Steam, Epic and GOG, and what it costs your drives.">
        <Button icon="refresh" onClick={load} disabled={loading}>Refresh</Button>
      </ToolHeader>

      {loading && !lib ? (
        <div className="center-pad"><Spinner size={32} /></div>
      ) : !lib || (!lib.games.length && !lib.leftovers.length) ? (
        <EmptyStart icon="gamepad" color="#ffc93c" title="No games found" text="We look for Steam, Epic Games and GOG Galaxy libraries. Install a game or a launcher and refresh." action="Refresh" onAction={load} />
      ) : (
        <>
          <section className="games-stats">
            <Card className="stat"><span className="eyebrow">Games</span><b>{lib.games.length}</b></Card>
            <Card className="stat"><span className="eyebrow">Total size</span><b className="text-gold">{bytes(total)}</b></Card>
            <Card className="stat"><span className="eyebrow">Dust collectors</span><b className="text-pink">{dusty.length}</b><small>not played in {DUSTY_DAYS}+ days</small></Card>
            <Card className="stat drives">
              <span className="eyebrow">By drive</span>
              {drives.map(([d, sz]) => (
                <div key={d} className="drive-row">
                  <span className="mono">{d}</span>
                  <Bar value={sz / total} color="var(--gold)" />
                  <b className="mono">{bytes(sz, 0)}</b>
                </div>
              ))}
            </Card>
          </section>

          {lib.leftovers.length > 0 && (
            <Card className="leftovers" glow="#ff2bd6">
              <div className="leftovers-head">
                <Icon name="trash" />
                <div>
                  <b>Leftovers from uninstalled games</b>
                  <p className="muted small">Steam leaves these behind. They go to the Recycle Bin so you can undo. Check for mods or saves first.</p>
                </div>
              </div>
              {lib.leftovers.map((l) => (
                <div key={l.path} className="item-row">
                  <Check state={sel.has(l.path)} disabled={l.inUse} onChange={(v) => { const n = new Set(sel); v ? n.add(l.path) : n.delete(l.path); setSel(n); }} />
                  <div className="ellipsis">
                    <b>{l.name}</b> <span className="muted small">{l.note}</span>
                    <div className="mono muted small ellipsis">{l.path}</div>
                  </div>
                  {l.inUse && <Badge tone="amber">Steam running</Badge>}
                  <Button small kind="subtle" icon="folder" title="Show in Explorer" onClick={() => invoke("reveal", { path: l.path })} />
                  <b className="mono">{bytes(l.size)}</b>
                </div>
              ))}
            </Card>
          )}

          <div className="games-toolbar">
            <Search value={q} onChange={setQ} placeholder="Search games" />
            <Segmented value={sort} onChange={setSort} options={[{ value: "size", label: "Biggest" }, { value: "played", label: "Least played" }, { value: "name", label: "A-Z" }]} />
          </div>

          <div className="game-grid">
            {games.map((g) => <GameCard key={`${g.launcher}-${g.id}`} g={g} onAct={(a) => act(g, a)} />)}
          </div>

          {sel.size > 0 && (
            <ActionBar note={`${sel.size} leftover folders selected`}>
              <Button kind="danger" icon="trash" disabled={busy} onClick={removeLeftovers}>Move {bytes(selSize)} to Recycle Bin</Button>
            </ActionBar>
          )}
        </>
      )}
    </div>
  );
}

function GameCard({ g, onAct }: { g: Game; onAct: (a: "play" | "verify" | "uninstall") => void }) {
  const [imgOk, setImgOk] = useState(g.launcher === "steam");
  const dusty = !!g.lastPlayed && Date.now() / 1000 - g.lastPlayed > DUSTY_DAYS * 86400;
  const l = LAUNCHER[g.launcher];
  const hue = [...g.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={cx("game", dusty && "dusty")}>
      <div className="game-art" style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 30%), hsl(${(hue + 60) % 360} 70% 15%))` }}>
        {imgOk ? (
          <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/header.jpg`} alt="" loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <span className="game-initial">{g.name.slice(0, 1)}</span>
        )}
        <span className="game-launcher" style={{ color: l.color }}>{l.label}</span>
        {dusty && <span className="dust-tag"><Icon name="clock" size={12} /> Dusty</span>}
      </div>
      <div className="game-body">
        <b className="ellipsis" title={g.name}>{g.name}</b>
        <div className="game-meta">
          <span className="mono text-gold">{bytes(g.size)}</span>
          <span className="muted">{g.drive}</span>
          <span className="muted">{g.lastPlayed ? timeAgo(g.lastPlayed) : g.launcher === "steam" ? "Never played" : ""}</span>
        </div>
        <div className="game-actions">
          <Button small kind="subtle" icon="play" onClick={() => onAct("play")} title="Play" />
          {g.launcher !== "gog" && <Button small kind="subtle" icon="wrench" onClick={() => onAct("verify")} title="Verify / repair game files" />}
          <Button small kind="subtle" icon="folder" onClick={() => invoke("reveal", { path: g.path })} title="Open folder" />
          <Button small kind="subtle" icon="trash" onClick={() => onAct("uninstall")} title={`Uninstall with ${l.label}`} />
        </div>
      </div>
    </div>
  );
}
