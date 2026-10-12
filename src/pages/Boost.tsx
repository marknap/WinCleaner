import { useEffect, useState } from "react";
import { invoke } from "../api";
import type { BoostReport, BoostState, Candidate, Fix, FixResult, Tweak } from "../api";
import { Badge, Button, Card, Check, Disclosure, Icon, Spinner, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
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
      s.toast(L("Back to normal. Power plan restored.", "Terug naar normaal. Energiebeheer hersteld."));
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
      s.toast(r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setFixState((x) => ({ ...x, [f.id]: { result: { ok: false, message: String(e) } } }));
    }
  }

  async function setTweak(t: Tweak, on: boolean) {
    setPending(t.id);
    try {
      await invoke("tweak_set", { id: t.id, on });
      s.toast(`${t.name}: ${on ? L("on", "aan") : L("off", "uit")}${t.reboot ? L(" (restart to apply)", " (herstart om toe te passen)") : ""}`);
      await load();
      s.refreshHistory();
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
      <ToolHeader icon="rocket" title="Game Boost" color="#ff2bd6" subtitle={L("Squeeze out every frame before you play.", "Haal elk frame eruit voordat je gaat spelen.")} />

      <section className={cx("boost-hero", active && "active")}>
        <button className="boost-btn" onClick={boost} disabled={boosting}>
          <span className="boost-glow" />
          {boosting ? <Spinner size={36} /> : <Icon name="rocket" size={44} />}
          <b>{boosting ? "BOOSTING" : active ? L("AGAIN", "NOG EENS") : "BOOST"}</b>
        </button>
        <div className="boost-info">
          {active ? (
            <>
              <Badge tone="lime" icon="bolt">{L("Boost active", "Boost actief")}</Badge>
              <h2>{L("You're running at full power", "Je draait op volle kracht")}</h2>
              <p className="muted">{L("High performance power plan and Game Mode are on. Restore when you're done to save power.", "Hoge prestaties en Gamemodus staan aan. Herstel als je klaar bent om stroom te besparen.")}</p>
              <Button icon="undo" onClick={restore}>{L("Restore normal mode", "Normale modus herstellen")}</Button>
            </>
          ) : (
            <>
              <h2>{L("One click before you play", "Eén klik voordat je gaat spelen")}</h2>
              <ul className="boost-list">
                <li><Icon name="check" size={15} /> {L(`Closes background apps you picked (${selectedApps.length})`, `Sluit gekozen achtergrondapps (${selectedApps.length})`)}</li>
                <li><Icon name="check" size={15} /> {L("Switches to the High performance power plan", "Schakelt naar het energiebeheerschema Hoge prestaties")}</li>
                <li><Icon name="check" size={15} /> {L("Makes sure Game Mode is on", "Zorgt dat Gamemodus aan staat")}</li>
                <li><Icon name="check" size={15} /> {admin ? L("Flushes DNS and frees standby RAM", "Leegt DNS en maakt standby-RAM vrij") : L("Flushes DNS", "Leegt de DNS-cache")}</li>
                {admin && s.prefs?.restorePoints && <li><Icon name="shield" size={15} /> {L("Creates a restore point first (once a day)", "Maakt eerst een herstelpunt (één keer per dag)")}</li>}
              </ul>
            </>
          )}
          <button className="link" onClick={() => setCustomize(!customize)}>
            {customize ? L("Hide app list", "App-lijst verbergen") : L("Choose which apps to close", "Kies welke apps sluiten")} <Icon name={customize ? "chevronDown" : "chevron"} size={14} />
          </button>
        </div>
        {report && (
          <Card className="boost-report" glow="#39ff88">
            <span className="eyebrow">{L("Boost report", "Boostrapport")}</span>
            {report.ramFreed > 0 && <h3 className="text-lime">+{bytes(report.ramFreed)} {L("RAM free", "RAM vrij")}</h3>}
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
          <p className="muted small">{L("Apps are closed politely, like clicking the X, so you'll be asked to save anything unsaved. Windows, drivers, anti-cheat, launchers and Discord are never listed.", "Apps worden netjes gesloten, alsof je op het kruisje klikt, dus je krijgt de vraag om op te slaan. Windows, drivers, anticheat, launchers en Discord staan er nooit tussen.")}</p>
          {cands === null ? <Spinner /> : cands.length === 0 ? <p className="muted">{L("No heavy background apps running.", "Geen zware achtergrondapps actief.")}</p> : (
            <div className="cand-grid">
              {cands.map((c) => (
                <label key={c.name} className="cand">
                  <Check state={c.selected} onChange={(v) => setCands(cands.map((x) => (x.name === c.name ? { ...x, selected: v } : x)))} />
                  <span className="ellipsis">{c.label}</span>
                  {c.suggested && <Badge tone="lime">{L("Suggested", "Aanbevolen")}</Badge>}
                  <b className="mono muted">{bytes(c.memory)}</b>
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      {state && (
        <>
          <h3 className="section-title">{L("Quick fixes", "Snelle oplossingen")}</h3>
          <div className="fix-grid">
            {state.fixes.filter((f) => !f.advanced).map((f) => <FixCard key={f.id} f={f} st={fixState[f.id]} admin={admin} onRun={() => runFix(f)} onAdmin={s.restartAdmin} />)}
          </div>

          <h3 className="section-title">{L("Gaming settings", "Game-instellingen")}</h3>
          <div className="tweak-list">
            {state.tweaks.filter((t) => !t.advanced).map((t) => <TweakRow key={t.id} t={t} admin={admin} busy={pending === t.id} onChange={(v) => setTweak(t, v)} />)}
          </div>

          <Disclosure title={L("Advanced", "Geavanceerd")} count={state.fixes.filter((f) => f.advanced).length + state.tweaks.filter((t) => t.advanced).length}>
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
        {f.admin && <Badge tone="cyan" icon="shield">{L("Admin", "Beheerder")}</Badge>}
        {f.slow && <Badge tone="amber" icon="clock">{L("Slow", "Traag")}</Badge>}
        {f.reboot && <Badge tone="pink">{L("Restart", "Herstart")}</Badge>}
      </div>
      <p>{f.detail}</p>
      <div className="fix-foot">
        {st?.result && <span className={cx("fix-result", st.result.ok ? "text-lime" : "text-red")}><Icon name={st.result.ok ? "check" : "x"} size={14} /> {st.result.message}</span>}
        {locked ? (
          <Button small icon="shield" onClick={onAdmin}>{L("Unlock", "Ontgrendelen")}</Button>
        ) : (
          <Button small kind="subtle" icon={st?.running ? undefined : "play"} disabled={st?.running} onClick={onRun}>
            {st?.running ? <><Spinner size={12} /> {L("Running", "Bezig")}</> : L("Run", "Uitvoeren")}
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
          {t.recommended && !t.on && <Badge tone="lime">{L("Recommended", "Aanbevolen")}</Badge>}
          {t.admin && <Badge tone="cyan" icon="shield">{L("Admin", "Beheerder")}</Badge>}
          {t.reboot && <Badge tone="pink">{L("Restart to apply", "Herstart om toe te passen")}</Badge>}
        </div>
        <p>{t.detail}</p>
      </div>
      {busy ? <Spinner /> : <Toggle on={t.on} disabled={locked} onChange={onChange} title={locked ? L("Needs admin", "Beheerder nodig") : undefined} />}
    </div>
  );
}
