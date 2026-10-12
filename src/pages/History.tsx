import { useEffect, useState } from "react";
import { invoke } from "../api";
import { Badge, Button, Card, CountUp, Icon, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { ACHIEVEMENTS, weekStreak } from "../achievements";
import { RANKS, bytes, cx, date, num, rankName, rankOf, toolLabel, toolId, xpOf } from "../util";

export default function History() {
  const s = useStore();
  const h = s.history;
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    s.refreshHistory();
  }, []);

  async function putBack(entry: string, index: number) {
    try {
      const msg = await invoke<string>("history_put_back", { entry, index });
      s.toast(msg);
      s.refreshHistory();
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  async function clear() {
    const r = await s.ask({
      title: L("Clear the log?", "Logboek wissen?"),
      icon: "trash",
      body: <p>{L("Your rank, XP and achievements stay. Only the list of removed items is cleared, so Put back won't be available for them anymore.", "Je rang, XP en prestaties blijven. Alleen de lijst met verwijderde items wordt gewist, dus Terugzetten kan daarna niet meer.")}</p>,
      buttons: [{ id: "no", label: L("Cancel", "Annuleren"), kind: "subtle" }, { id: "yes", label: L("Clear log", "Logboek wissen"), kind: "danger" }],
    });
    if (r !== "yes") return;
    await invoke("history_clear");
    s.refreshHistory();
  }

  if (!h) return null;
  const xp = xpOf(h);
  const r = rankOf(xp);
  const streak = weekStreak(h);
  const got = ACHIEVEMENTS.filter((a) => a.test(h)).length;

  return (
    <div className="page">
      <ToolHeader icon="history" title={L("History", "Geschiedenis")} color="#8a93b8" subtitle={L("Your rank, achievements and everything WinCleaner removed.", "Je rang, prestaties en alles wat WinCleaner heeft verwijderd.")}>
        {h.entries.length > 0 && <Button icon="trash" onClick={clear}>{L("Clear log", "Logboek wissen")}</Button>}
      </ToolHeader>

      <Card className="rank-ladder" glow={r.rank.color}>
        <div className="ladder-top">
          <div>
            <span className="eyebrow">{L("Rank", "Rang")}</span>
            <h2 style={{ color: r.rank.color }}>{rankName(r.rank)}</h2>
            <p className="muted small">{L("XP = 1 per MB freed, 100 per boost, 25 per scan", "XP = 1 per vrijgemaakte MB, 100 per boost, 25 per scan")}</p>
          </div>
          <div className="ladder-xp mono"><CountUp value={xp} /> XP</div>
        </div>
        <div className="ladder">
          {RANKS.map((k) => (
            <div key={k.id} className={cx("rung", xp >= k.min && "got", k.id === r.rank.id && "cur")} style={{ "--c": k.color } as React.CSSProperties}>
              <span className="gem"><Icon name="trophy" size={14} /></span>
              <b>{rankName(k)}</b>
              <span className="muted small mono">{num(k.min)}</span>
            </div>
          ))}
        </div>
        <div className="rank-stats">
          <div><b>{bytes(h.lifetimeFreed)}</b><span>{L("freed all-time", "totaal vrijgemaakt")}</span></div>
          <div><b>{num(h.lifetimeItems)}</b><span>{L("items removed", "items verwijderd")}</span></div>
          <div><b>{h.boosts}</b><span>boosts</span></div>
          <div className={streak > 0 ? "streak" : ""}><b>{streak > 0 && <Icon name="flame" size={14} />} {streak}</b><span>{L("week streak", "weken op rij")}</span></div>
        </div>
      </Card>

      <h3 className="section-title">{L(`Achievements ${got}/${ACHIEVEMENTS.length}`, `Prestaties ${got}/${ACHIEVEMENTS.length}`)}</h3>
      <div className="achievements">
        {ACHIEVEMENTS.map((a) => {
          const ok = a.test(h);
          return (
            <div key={a.id} className={cx("ach", ok && "got")} style={{ "--c": a.color } as React.CSSProperties} title={a.desc()}>
              <span className="ach-icon"><Icon name={ok ? a.icon : "lock"} size={20} /></span>
              <div>
                <b>{a.name()}</b>
                <p>{a.desc()}</p>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="section-title">{L("Log", "Logboek")}</h3>
      {h.entries.length === 0 ? (
        <p className="muted center-pad">{L("Nothing removed yet.", "Nog niets verwijderd.")}</p>
      ) : (
        <div className="history-list">
          {h.entries.map((e) => (
            <div key={e.id} className={cx("hist", open === e.id && "open")}>
              <button className="hist-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <Icon name="chevron" size={14} className="chev" />
                <b>{toolLabel(toolId(e.tool))}</b>
                <span className="muted small">{date(e.date)}</span>
                <span className="muted small">{e.items.length} items</span>
                <b className="mono text-lime">{bytes(e.freed)}</b>
              </button>
              {open === e.id && (
                <div className="hist-items">
                  {e.items.map((it, i) => (
                    <div key={i} className="item-row">
                      <Icon name={it.backup ? "key" : "file"} size={14} />
                      <span className="mono small ellipsis" title={it.path}>{it.path}</span>
                      {!it.backup && <span className="mono small muted">{bytes(it.size)}</span>}
                      {it.restored ? <Badge tone="lime">{L("Restored", "Teruggezet")}</Badge> : it.recycled || it.backup ? (
                        <Button small icon="undo" onClick={() => putBack(e.id, i)}>{L("Put back", "Terugzetten")}</Button>
                      ) : <Badge>{L("Deleted", "Verwijderd")}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
