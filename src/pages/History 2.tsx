import { useEffect, useState } from "react";
import { invoke } from "../api";
import { Badge, Button, Card, CountUp, Icon, ToolHeader } from "../components";
import { useStore } from "../store";
import { RANKS, bytes, cx, date, rankOf, xpOf } from "../util";

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
    await invoke("history_clear");
    s.refreshHistory();
  }

  if (!h) return null;
  const xp = xpOf(h);
  const r = rankOf(xp);

  return (
    <div className="page">
      <ToolHeader icon="history" title="History" color="#8a93b8" subtitle="Everything WinCleaner removed. Items in the Recycle Bin can be put back.">
        {h.entries.length > 0 && <Button icon="trash" onClick={clear}>Clear log</Button>}
      </ToolHeader>

      <Card className="rank-ladder" glow={r.rank.color}>
        <div className="ladder-top">
          <div>
            <span className="eyebrow">Rank</span>
            <h2 style={{ color: r.rank.color }}>{r.rank.name}</h2>
            <p className="muted small">XP = 1 per MB freed, 100 per boost, 25 per scan</p>
          </div>
          <div className="ladder-xp mono"><CountUp value={xp} /> XP</div>
        </div>
        <div className="ladder">
          {RANKS.map((k) => (
            <div key={k.name} className={cx("rung", xp >= k.min && "got", k.name === r.rank.name && "cur")} style={{ "--c": k.color } as React.CSSProperties}>
              <span className="gem"><Icon name="trophy" size={14} /></span>
              <b>{k.name}</b>
              <span className="muted small mono">{k.min.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="rank-stats">
          <div><b>{bytes(h.lifetimeFreed)}</b><span>freed all-time</span></div>
          <div><b>{h.lifetimeItems.toLocaleString()}</b><span>items removed</span></div>
          <div><b>{h.boosts}</b><span>boosts</span></div>
          <div><b>{h.scans}</b><span>scans</span></div>
        </div>
      </Card>

      {h.entries.length === 0 ? (
        <p className="muted center-pad">Nothing removed yet.</p>
      ) : (
        <div className="history-list">
          {h.entries.map((e) => (
            <div key={e.id} className={cx("hist", open === e.id && "open")}>
              <button className="hist-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <Icon name="chevron" size={14} className="chev" />
                <b>{e.tool}</b>
                <span className="muted small">{date(e.date)}</span>
                <span className="muted small">{e.items.length} items</span>
                <b className="mono text-lime">{bytes(e.freed)}</b>
              </button>
              {open === e.id && (
                <div className="hist-items">
                  {e.items.map((it, i) => (
                    <div key={i} className="item-row">
                      <span className="mono small ellipsis" title={it.path}>{it.path}</span>
                      <span className="mono small muted">{bytes(it.size)}</span>
                      {it.restored ? <Badge tone="lime">Restored</Badge> : it.recycled ? (
                        <Button small icon="undo" onClick={() => putBack(e.id, i)}>Put back</Button>
                      ) : <Badge>Deleted</Badge>}
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
