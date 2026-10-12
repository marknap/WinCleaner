import { useEffect, useMemo, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, ClipsSummary, Drive, Game, Launcher, Library, UninstallResult } from "../api";
import { ActionBar, Badge, Bar, Button, Card, Check, EmptyStart, Icon, Search, Segmented, Spinner, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { bytes, cx, timeAgo } from "../util";

const LAUNCHER: Record<Launcher, { label: string; color: string }> = {
  steam: { label: "Steam", color: "#66c0f4" },
  epic: { label: "Epic", color: "#e8ecff" },
  gog: { label: "GOG", color: "#b98cff" },
  battlenet: { label: "Battle.net", color: "#148eff" },
};

const DUSTY_DAYS = 90;
const isDusty = (g: Game) => !!g.lastPlayed && Date.now() / 1000 - g.lastPlayed > DUSTY_DAYS * 86400;

// Steam art is read from disk once per session.
const artCache = new Map<string, string | null>();

interface Move { from: Drive; to: Drive; picks: Game[]; freed: number }

/** Suggest games to move off a nearly full drive, least-played first. */
function planMoves(games: Game[], drives: Drive[]): Move[] {
  const out: Move[] = [];
  const now = Date.now() / 1000;
  for (const d of drives) {
    const letter = d.path.slice(0, 2).toUpperCase();
    const here = games.filter((g) => g.drive === letter && g.size > 0 && !(g.lastPlayed && now - g.lastPlayed < 14 * 86400));
    if (!here.length || !d.total || d.free / d.total >= 0.15) continue;
    const target = drives.filter((o) => o !== d && o.total > 0).sort((a, b) => b.free - a.free)[0];
    if (!target) continue;
    const goal = d.total * 0.25 - d.free;
    const idle = (g: Game) => (g.lastPlayed ? now - g.lastPlayed : 60 * 86400);
    const ranked = [...here].sort((a, b) => idle(b) - idle(a) || b.size - a.size);
    let room = target.free * 0.9;
    let freed = 0;
    const picks: Game[] = [];
    for (const g of ranked) {
      if (picks.length >= 5 || freed >= goal) break;
      if (g.size <= room) {
        picks.push(g);
        freed += g.size;
        room -= g.size;
      }
    }
    if (picks.length) out.push({ from: d, to: target, picks, freed });
  }
  return out;
}

function howToMove(l: Launcher, to: string): string {
  switch (l) {
    case "steam":
      return L(
        `In Steam: Settings → Storage → add a library on ${to}. Then right-click the game → Properties → Installed Files → Move install folder.`,
        `In Steam: Instellingen → Opslag → voeg een bibliotheek toe op ${to}. Klik daarna met rechts op de game → Eigenschappen → Geïnstalleerde bestanden → Installatiemap verplaatsen.`,
      );
    case "gog":
      return L(`In GOG Galaxy: open the game → settings icon → Manage installation → Move, and pick ${to}.`, `In GOG Galaxy: open de game → instellingen-icoon → Installatie beheren → Verplaatsen, en kies ${to}.`);
    case "epic":
      return L(
        `Epic can't move games. Copy the game folder to ${to}, uninstall it in Epic, then click Install and choose the copied folder. Epic verifies it instead of downloading again.`,
        `Epic kan games niet verplaatsen. Kopieer de gamemap naar ${to}, verwijder de game in Epic en klik op Installeren met de gekopieerde map als locatie. Epic controleert dan in plaats van opnieuw te downloaden.`,
      );
    case "battlenet":
      return L(
        `Move the game folder to ${to}, then in Battle.net choose "Locate the game" and point to the new folder.`,
        `Verplaats de gamemap naar ${to} en kies in Battle.net "Game zoeken" met de nieuwe map.`,
      );
  }
}

export default function Games() {
  const s = useStore();
  const [lib, setLib] = useState<Library | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [clips, setClips] = useState<ClipsSummary | null>(null);
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
    invoke<Drive[]>("drives").then(setDrives).catch(() => {});
    invoke<ClipsSummary>("clips_summary").then(setClips).catch(() => {});
  };
  useEffect(load, []);

  const games = useMemo(() => {
    const g = (lib?.games ?? []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
    if (sort === "name") g.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "played") g.sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0));
    else g.sort((a, b) => b.size - a.size);
    return g;
  }, [lib, sort, q]);

  const byDrive = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of lib?.games ?? []) m[g.drive] = (m[g.drive] ?? 0) + g.size;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [lib]);

  const moves = useMemo(() => planMoves(lib?.games ?? [], drives), [lib, drives]);
  const total = (lib?.games ?? []).reduce((a, g) => a + g.size, 0);
  const dusty = (lib?.games ?? []).filter(isDusty);

  async function act(g: Game, action: "play" | "verify" | "uninstall") {
    try {
      if (action === "uninstall" && g.uninstallId) {
        const ok = await s.ask({
          title: L(`Uninstall ${g.name}?`, `${g.name} verwijderen?`),
          icon: "trash",
          body: <p>{L("This opens the game's own uninstaller. Afterwards we'll look for leftovers.", "Dit opent het verwijderprogramma van de game. Daarna zoeken we naar restjes.")}</p>,
          buttons: [{ id: "no", label: L("Cancel", "Annuleren"), kind: "subtle" }, { id: "yes", label: L("Uninstall", "Verwijderen"), kind: "danger" }],
        });
        if (ok !== "yes") return;
        const r = await invoke<UninstallResult>("app_uninstall", { id: g.uninstallId });
        s.toast(r.message, r.stillInstalled ? "info" : "ok");
        load();
        return;
      }
      await invoke("game_action", { launcher: g.launcher, id: g.id, action });
      if (action === "uninstall") s.toast(L(`Finish the uninstall in ${LAUNCHER[g.launcher].label}, then refresh.`, `Rond het verwijderen af in ${LAUNCHER[g.launcher].label} en vernieuw daarna.`), "info");
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  async function removeLeftovers() {
    setBusy(true);
    try {
      const r = await invoke<ActionResult>("game_leftovers_trash", { paths: [...sel] });
      s.toast(r.message, r.failed.length ? "info" : "ok");
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
      <ToolHeader icon="gamepad" title={L("My Games", "Mijn games")} color="#ffc93c" subtitle={L("Every installed game across Steam, Epic, GOG and Battle.net, and what it costs your drives.", "Alle geïnstalleerde games van Steam, Epic, GOG en Battle.net, en wat ze je schijven kosten.")}>
        <Button icon="refresh" onClick={load} disabled={loading}>{L("Refresh", "Vernieuwen")}</Button>
      </ToolHeader>

      {loading && !lib ? (
        <div className="center-pad"><Spinner size={32} /></div>
      ) : !lib || (!lib.games.length && !lib.leftovers.length) ? (
        <EmptyStart icon="gamepad" color="#ffc93c" title={L("No games found", "Geen games gevonden")} text={L("We look for Steam, Epic Games, GOG Galaxy and Battle.net libraries. Install a game or a launcher and refresh.", "We zoeken naar bibliotheken van Steam, Epic Games, GOG Galaxy en Battle.net. Installeer een game of launcher en vernieuw.")} action={L("Refresh", "Vernieuwen")} onAction={load} />
      ) : (
        <>
          <section className="games-stats">
            <Card className="stat"><span className="eyebrow">Games</span><b>{lib.games.length}</b></Card>
            <Card className="stat"><span className="eyebrow">{L("Total size", "Totale grootte")}</span><b className="text-gold">{bytes(total)}</b></Card>
            <Card className="stat"><span className="eyebrow">{L("Dust collectors", "Stofnesten")}</span><b className="text-pink">{dusty.length}</b><small>{L(`not played in ${DUSTY_DAYS}+ days`, `${DUSTY_DAYS}+ dagen niet gespeeld`)}</small></Card>
            <Card className="stat drives">
              <span className="eyebrow">{L("By drive", "Per station")}</span>
              {byDrive.map(([d, sz]) => (
                <div key={d} className="drive-row">
                  <span className="mono">{d}</span>
                  <Bar value={sz / total} color="var(--gold)" />
                  <b className="mono">{bytes(sz, 0)}</b>
                </div>
              ))}
            </Card>
          </section>

          {moves.map((m) => (
            <Card key={m.from.path} className="planner" glow="#00f0ff">
              <div className="planner-head">
                <Icon name="truck" size={22} />
                <div>
                  <b>{L(`${m.from.path} is ${Math.round((1 - m.from.free / m.from.total) * 100)}% full`, `${m.from.path} is voor ${Math.round((1 - m.from.free / m.from.total) * 100)}% vol`)}</b>
                  <p className="muted small">{L(`Move these to ${m.to.path} to free ${bytes(m.freed)}. Least-played games first.`, `Verplaats deze naar ${m.to.path} om ${bytes(m.freed)} vrij te maken. Minst gespeelde games eerst.`)}</p>
                </div>
              </div>
              {m.picks.map((g) => (
                <details key={`${g.launcher}-${g.id}`} className="move-row">
                  <summary>
                    <span className="game-launcher-dot" style={{ background: LAUNCHER[g.launcher].color }} />
                    <span className="ellipsis">{g.name}</span>
                    <span className="muted small">{g.lastPlayed ? timeAgo(g.lastPlayed) : ""}</span>
                    <b className="mono">{bytes(g.size)}</b>
                    <span className="link small">{L("How?", "Hoe?")}</span>
                  </summary>
                  <p className="small muted">{howToMove(g.launcher, m.to.path)}</p>
                </details>
              ))}
            </Card>
          ))}

          {lib.leftovers.length > 0 && (
            <Card className="leftovers" glow="#ff2bd6">
              <div className="leftovers-head">
                <Icon name="trash" />
                <div>
                  <b>{L("Leftovers from uninstalled games", "Restjes van verwijderde games")}</b>
                  <p className="muted small">{L("Steam leaves these behind. They go to the Recycle Bin so you can undo. Check for mods or saves first.", "Steam laat deze achter. Ze gaan naar de Prullenbak, dus je kunt het terugdraaien. Controleer eerst op mods of saves.")}</p>
                </div>
              </div>
              {lib.leftovers.map((l) => (
                <div key={l.path} className="item-row">
                  <Check state={sel.has(l.path)} disabled={l.inUse} onChange={(v) => { const n = new Set(sel); v ? n.add(l.path) : n.delete(l.path); setSel(n); }} />
                  <div className="ellipsis">
                    <b>{l.name}</b> <span className="muted small">{l.note}</span>
                    <div className="mono muted small ellipsis">{l.path}</div>
                  </div>
                  {l.inUse && <Badge tone="amber">{L("Steam running", "Steam draait")}</Badge>}
                  <Button small kind="subtle" icon="folder" title={L("Show in Explorer", "Tonen in Verkenner")} onClick={() => invoke("reveal", { path: l.path })} />
                  <b className="mono">{bytes(l.size)}</b>
                </div>
              ))}
            </Card>
          )}

          {clips && clips.size > 1024 ** 3 && (
            <Card className="clips" glow="#b98cff">
              <Icon name="video" size={22} />
              <div>
                <b>{L("Game clips & recordings", "Gameclips en opnames")}</b>
                <p className="muted small">{L(`${bytes(clips.size)} in ${clips.count} videos in your Videos folder (Game Bar, ShadowPlay, ReLive, OBS). Review and keep your best plays.`, `${bytes(clips.size)} in ${clips.count} video's in je map Video's (Game Bar, ShadowPlay, ReLive, OBS). Bekijk ze en bewaar je beste momenten.`)}</p>
              </div>
              <Button small onClick={() => s.go("bigfiles", { bigFilesMode: "clips" })}>{L("Review", "Bekijken")}</Button>
            </Card>
          )}

          <div className="games-toolbar">
            <Search value={q} onChange={setQ} placeholder={L("Search games", "Games zoeken")} />
            <Segmented value={sort} onChange={setSort} options={[{ value: "size", label: L("Biggest", "Grootste") }, { value: "played", label: L("Least played", "Minst gespeeld") }, { value: "name", label: "A-Z" }]} />
          </div>

          <div className="game-grid">
            {games.map((g) => <GameCard key={`${g.launcher}-${g.id}`} g={g} onAct={(a) => act(g, a)} />)}
          </div>

          {sel.size > 0 && (
            <ActionBar note={L(`${sel.size} leftover folders selected`, `${sel.size} restmappen geselecteerd`)}>
              <Button kind="danger" icon="trash" disabled={busy} onClick={removeLeftovers}>{L(`Move ${bytes(selSize)} to Recycle Bin`, `${bytes(selSize)} naar Prullenbak`)}</Button>
            </ActionBar>
          )}
        </>
      )}
    </div>
  );
}

function GameCard({ g, onAct }: { g: Game; onAct: (a: "play" | "verify" | "uninstall") => void }) {
  const [art, setArt] = useState<string | null>(artCache.get(g.id) ?? null);
  useEffect(() => {
    if (g.launcher !== "steam" || artCache.has(g.id)) return;
    invoke<string | null>("game_art", { appid: g.id }).then((a) => {
      artCache.set(g.id, a);
      setArt(a);
    }).catch(() => artCache.set(g.id, null));
  }, [g]);
  const dusty = isDusty(g);
  const l = LAUNCHER[g.launcher];
  const hue = [...g.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={cx("game", dusty && "dusty")}>
      <div className="game-art" style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 30%), hsl(${(hue + 60) % 360} 70% 15%))` }}>
        {art ? <img src={art} alt="" /> : <span className="game-initial">{g.name.slice(0, 1)}</span>}
        <span className="game-launcher" style={{ color: l.color }}>{l.label}</span>
        {dusty && <span className="dust-tag"><Icon name="clock" size={12} /> {L("Dusty", "Stoffig")}</span>}
      </div>
      <div className="game-body">
        <b className="ellipsis" title={g.name}>{g.name}</b>
        <div className="game-meta">
          <span className="mono text-gold">{bytes(g.size)}</span>
          <span className="muted">{g.drive}</span>
          <span className="muted">{g.lastPlayed ? timeAgo(g.lastPlayed) : g.launcher === "steam" ? L("Never played", "Nooit gespeeld") : ""}</span>
        </div>
        <div className="game-actions">
          <Button small kind="subtle" icon="play" onClick={() => onAct("play")} title={L("Play", "Spelen")} />
          {(g.launcher === "steam" || g.launcher === "epic") && <Button small kind="subtle" icon="wrench" onClick={() => onAct("verify")} title={L("Verify / repair game files", "Gamebestanden controleren / herstellen")} />}
          {g.path && <Button small kind="subtle" icon="folder" onClick={() => invoke("reveal", { path: g.path })} title={L("Open folder", "Map openen")} />}
          <Button small kind="subtle" icon="trash" onClick={() => onAct("uninstall")} title={L(`Uninstall with ${l.label}`, `Verwijderen via ${l.label}`)} />
        </div>
      </div>
    </div>
  );
}
