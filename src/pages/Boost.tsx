import { useEffect, useState } from "react";
import { invoke } from "../api";
import type { BoostReport, BoostState, Candidate, Fix, FixResult, Tweak } from "../api";
import { Badge, Button, Card, Check, Disclosure, Icon, Spinner, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";
import { bytes, cx } from "../util";

type FixState = { running?: boolean; result?: FixResult };

export default function Boost() {
  const s = useStore();
  const [state, setState] = useState<BoostState | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [report, setReport] = useState<BoostReport | null>(null);
  const [fixState, setFixState] = useState<Record<string, FixState>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [customize, setCustomize] = useState(false);

  const load = () => invoke<BoostState>("boost_state").then(setState).catch((e) => s.toast(String(e), "err"));

  useEffect(() => {
    load();
    invoke<Candidate[]>("boost_candidates").then(setCands).catch(() => setCands([]));
  }, []);

  async function boost() {
    setBoosting(true);
    setReport(null);
    try {
      const close = (cands ?? []).filter((c) => c.selected).map((c) => c.name);
      const r = await invoke<BoostReport>("game_boost", { close });
      setReport(r);
      s.celebrate();
      s.refreshHistory();
      load();
      invoke<Candidate[]>("boost_candidates").then(setCands);
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBoosting(false);
  }

  async function restore() {
    try {
      await invoke("boost_restore");
      setReport(null);
      s.toast("Back to normal. Power plan restored.");
      load();
    } catch (e) {
      s.toast(String(e), "err");
    }
  }

  async function runFix(f: Fix) {
    setFixState((x) => ({ ...x, [f.id]: { running: true } }));
    try {
      const r = await invoke<FixResult>("boost_fix", { id: f.id });
      setFixState((x) => ({ ...x, [f.id]: { result: r } }));
      if (r.ok) s.toast(r.message);
      else s.toast(r.message, "err");
    } catch (e) {
      setFixState((x) => ({ ...x, [f.id]: { result: { ok: false, message: String(e) } } }));
    }
  }

  async function setTweak(t: Tweak, on: boolean) {
    setPending(t.id);
    try {
      await invoke("tweak_set", { id: t.id, on });
      s.toast(`${t.name}: ${on ? "on" : "off"}${t.reboot ? " (restart to apply)" : ""}`);
      await load();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setPending(null);
  }

  const admin = s.info?.isAdmin ?? false;
  const active = state?.boostActive;
  const selectedApps = (cands ?? []).filter((c) => c.selected);

  return (
    <div className="page">
      <ToolHeader icon="rocket" title="Game Boost" color="#ff2bd6" subtitle="Squeeze out every frame before you play." />

      <section className={cx("boost-hero", active && "active")}>
        <button className="boost-btn" onClick={boost} disabled={boosting}>
          <span className="boost-glow" />
          {boosting ? <Spinner size={36} /> : <Icon name="rocket" size={44} />}
          <b>{boosting ? "BOOSTING" : active ? "BOOST AGAIN" : "BOOST"}</b>
        </button>
        <div className="boost-info">
          {active ? (
            <>
              <Badge tone="lime" icon="bolt">Boost active</Badge>
              <h2>You're running at full power</h2>
              <p className="muted">High performance power plan and Game Mode are on. Restore when you're done to save power.</p>
              <Button icon="undo" onClick={restore}>Restore normal mode</Button>
            </>
          ) : (
            <>
              <h2>One click before you play</h2>
              <ul className="boost-list">
                <li><Icon name="check" size={15} /> Closes background apps you picked ({selectedApps.length})</li>
                <li><Icon name="check" size={15} /> Switches to the High performance power plan</li>
                <li><Icon name="check" size={15} /> Makes sure Game Mode is on</li>
                <li><Icon name="check" size={15} /> Flushes DNS {admin ? "and frees standby RAM" : ""}</li>
              </ul>
            </>
          )}
          <button className="link" onClick={() => setCustomize(!customize)}>
            {customize ? "Hide" : "Choose"} which apps to close <Icon name={customize ? "chevronDown" : "chevron"} size={14} />
          </button>
        </div>
        {report && (
          <Card className="boost-report" glow="#39ff88">
            <span className="eyebrow">Boost report</span>
            {report.ramFreed > 0 && <h3 className="text-lime">+{bytes(report.ramFreed)} RAM free</h3>}
            <ul>
              {report.steps.map((st) => (
                <li key={st.label} className={st.ok ? "ok" : "fail"}>
                  <Icon name={st.ok ? "check" : "x"} size={14} />
                  <span><b>{st.label}</b> {st.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {customize && (
        <Card className="cands">
          <p className="muted small">Apps are closed politely, like clicking the X, so you'll be asked to save anything unsaved. Windows, drivers, anti-cheat, launchers and Discord are never listed.</p>
          {cands === null ? <Spinner /> : cands.length === 0 ? <p className="muted">No heavy background apps running.</p> : (
            <div className="cand-grid">
              {cands.map((c) => (
                <label key={c.name} className="cand">
                  <Check state={c.selected} onChange={(v) => setCands(cands.map((x) => (x.name === c.name ? { ...x, selected: v } : x)))} />
                  <span className="ellipsis">{c.label}</span>
                  {c.suggested && <Badge tone="lime">Suggested</Badge>}
                  <b className="mono muted">{bytes(c.memory)}</b>
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      {state && (
        <>
          <h3 className="section-title">Quick fixes</h3>
          <div className="fix-grid">
            {state.fixes.filter((f) => !f.advanced).map((f) => <FixCard key={f.id} f={f} st={fixState[f.id]} admin={admin} onRun={() => runFix(f)} onAdmin={s.restartAdmin} />)}
          </div>

          <h3 className="section-title">Gaming settings</h3>
          <div className="tweak-list">
            {state.tweaks.filter((t) => !t.advanced).map((t) => <TweakRow key={t.id} t={t} admin={admin} busy={pending === t.id} onChange={(v) => setTweak(t, v)} />)}
          </div>

          <Disclosure title="Advanced" count={state.fixes.filter((f) => f.advanced).length + state.tweaks.filter((t) => t.advanced).length}>
            <div className="tweak-list">
              {state.tweaks.filter((t) => t.advanced).map((t) => <TweakRow key={t.id} t={t} admin={admin} busy={pending === t.id} onChange={(v) => setTweak(t, v)} />)}
            </div>
            <div className="fix-grid">
              {state.fixes.filter((f) => f.advanced).map((f) => <FixCard key={f.id} f={f} st={fixState[f.id]} admin={admin} onRun={() => runFix(f)} onAdmin={s.restartAdmin} />)}
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}

function FixCard({ f, st, admin, onRun, onAdmin }: { f: Fix; st?: FixState; admin: boolean; onRun: () => void; onAdmin: () => void }) {
  const locked = f.admin && !admin;
  return (
    <Card className="fix">
      <div className="fix-head">
        <b>{f.name}</b>
        {f.admin && <Badge tone="cyan" icon="shield">Admin</Badge>}
        {f.slow && <Badge tone="amber" icon="clock">Slow</Badge>}
        {f.reboot && <Badge tone="pink">Restart</Badge>}
      </div>
      <p>{f.detail}</p>
      <div className="fix-foot">
        {st?.result && <span className={cx("fix-result", st.result.ok ? "text-lime" : "text-red")}><Icon name={st.result.ok ? "check" : "x"} size={14} /> {st.result.message}</span>}
        {locked ? (
          <Button small icon="shield" onClick={onAdmin}>Unlock</Button>
        ) : (
          <Button small kind="subtle" icon={st?.running ? undefined : "play"} disabled={st?.running} onClick={onRun}>
            {st?.running ? <><Spinner size={12} /> Running</> : "Run"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function TweakRow({ t, admin, busy, onChange }: { t: Tweak; admin: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  const locked = t.admin && !admin;
  return (
    <div className="tweak">
      <div className="tweak-text">
        <div className="tweak-name">
          {t.name}
          {t.recommended && !t.on && <Badge tone="lime">Recommended</Badge>}
          {t.admin && <Badge tone="cyan" icon="shield">Admin</Badge>}
          {t.reboot && <Badge tone="pink">Restart to apply</Badge>}
        </div>
        <p>{t.detail}</p>
      </div>
      {busy ? <Spinner /> : <Toggle on={t.on} disabled={locked} onChange={onChange} title={locked ? "Needs admin" : undefined} />}
    </div>
  );
}
