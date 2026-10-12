import { useEffect, useRef, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, CleanGroup, Drive, FileEntry, Library, StartupItem } from "../api";
import { Badge, Banner, Bar, Button, Card, CountUp, Icon, Ring, Spinner } from "../components";
import { defaultSelection, selectedTargets, useStore } from "../store";
import { bytes, grade, rankOf, xpOf } from "../util";

interface Findings {
  lib: Library | null;
  startup: StartupItem[] | null;
  big: FileEntry[] | null;
  drives: Drive[];
  score: number;
}

// Survives page switches for the lifetime of the window.
let cached: Findings | null = null;

const STEPS = ["Junk & caches", "Game library", "Startup apps", "Big files"];

export default function Home() {
  const s = useStore();
  const [findings, setFindings] = useState<Findings | null>(cached);
  const [step, setStep] = useState(-1);
  const [cleaning, setCleaning] = useState(false);
  const [cleanedNow, setCleanedNow] = useState<number | null>(null);
  const abort = useRef(false);

  const groups = s.clean.groups;
  const junk = groups ? selectedTargets(groups, s.clean.selected).reduce((a, t) => a + t.size, 0) : 0;

  async function scan() {
    abort.current = false;
    setCleanedNow(null);
    try {
      setStep(0);
      const g = await invoke<CleanGroup[]>("clean_scan", { onlyAuto: false });
      s.clean.setGroups(g);
      const sel = defaultSelection(g);
      s.clean.setSelected(sel);
      if (abort.current) return finish(null);
      setStep(1);
      const lib = await invoke<Library>("games_list").catch(() => null);
      if (abort.current) return finish(null);
      setStep(2);
      const startup = await invoke<StartupItem[]>("startup_list").catch(() => null);
      if (abort.current) return finish(null);
      setStep(3);
      const big = await invoke<FileEntry[]>("large_scan").catch(() => null);
      const drives = await invoke<Drive[]>("drives").catch(() => []);
      const junkBytes = selectedTargets(g, sel).reduce((a, t) => a + t.size, 0);
      finish({ lib, startup, big, drives, score: score(junkBytes, startup, lib, drives) });
      s.refreshHistory();
    } catch (e) {
      s.toast(String(e), "err");
      finish(null);
    }
  }

  function finish(f: Findings | null) {
    setStep(-1);
    if (f) {
      cached = f;
      setFindings(f);
    }
  }

  function cancel() {
    abort.current = true;
    invoke("cancel_job");
  }

  async function cleanNow() {
    if (!groups) return;
    setCleaning(true);
    try {
      const r = await invoke<ActionResult>("clean_run", { targets: selectedTargets(groups, s.clean.selected), tool: "Smart Scan" });
      s.toast(r.message, r.failed.length ? "info" : "ok");
      if (r.freed > 0) s.celebrate();
      setCleanedNow(r.freed);
      s.clean.setGroups(null);
      s.clean.setSelected(new Set());
      if (findings) {
        cached = { ...findings, score: Math.min(100, findings.score + Math.min(35, (r.freed / 1024 ** 3) * 6)) };
        setFindings(cached);
      }
      s.refreshHistory();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setCleaning(false);
  }

  // Tray "Quick Clean": safe categories only, nothing that's in use.
  useEffect(() => {
    const h = async () => {
      setCleaning(true);
      try {
        const g = await invoke<CleanGroup[]>("clean_scan", { onlyAuto: true });
        const r = await invoke<ActionResult>("clean_run", { targets: selectedTargets(g, defaultSelection(g)), tool: "Quick Clean" });
        s.toast(r.message);
        if (r.freed > 0) s.celebrate();
        s.refreshHistory();
      } catch (e) {
        s.toast(String(e), "err");
      }
      setCleaning(false);
    };
    window.addEventListener("quickclean", h);
    return () => window.removeEventListener("quickclean", h);
  }, [s]);

  const scanning = step >= 0;
  const h = s.history;
  const rank = h ? rankOf(xpOf(h)) : null;

  return (
    <div className="page home">
      {s.info && !s.info.isAdmin && (
        <Banner tone="cyan" icon="shield" action={<Button small icon="shield" onClick={s.restartAdmin}>Restart as admin</Button>}>
          <b>Unlock full power.</b> Windows Update leftovers, system crash dumps and a few boosts need admin rights.
        </Banner>
      )}

      <section className="hero">
        <div className="hero-main">
          {scanning ? (
            <div className="scan-orb scanning">
              <div className="orb-ring" />
              <div className="orb-core">
                <Spinner size={28} />
                <b>{STEPS[step]}</b>
                <span className="mono small">{bytes(s.progress?.bytes ?? 0)} checked</span>
              </div>
            </div>
          ) : findings && cleanedNow === null && groups ? (
            <ResultOrb score={findings.score} junk={junk} />
          ) : (
            <button className="scan-orb" onClick={scan} disabled={cleaning}>
              <div className="orb-ring" />
              <div className="orb-core">
                <Icon name="bolt" size={40} />
                <b>{findings ? "SCAN AGAIN" : "SCAN"}</b>
                <span>{cleanedNow !== null ? `Freed ${bytes(cleanedNow)} · GG!` : "One click checkup"}</span>
              </div>
            </button>
          )}
          {(scanning || !findings || !groups) && (
            <div className="hero-steps">
              {STEPS.map((label, i) => (
                <span key={label} className={step === i ? "active" : step > i ? "done" : ""}>
                  {step > i ? <Icon name="check" size={13} /> : <i />} {label}
                </span>
              ))}
            </div>
          )}
          {scanning && <Button small icon="x" onClick={cancel}>Cancel</Button>}
          {!scanning && findings && groups && (
            <div className="hero-cta">
              <Button kind="primary" icon="sparkle" onClick={cleanNow} disabled={cleaning || junk === 0}>
                {cleaning ? "Cleaning..." : junk > 0 ? `Clean ${bytes(junk)}` : "Nothing to clean"}
              </Button>
              <Button icon="refresh" onClick={scan}>Rescan</Button>
            </div>
          )}
        </div>

        <div className="hero-side">
          {rank && h && (
            <Card className="rank-card" glow={rank.rank.color}>
              <div className="rank-top">
                <div className="rank-badge" style={{ "--c": rank.rank.color } as React.CSSProperties}>
                  <Icon name="trophy" size={26} />
                </div>
                <div>
                  <span className="eyebrow">Your rank</span>
                  <h3 style={{ color: rank.rank.color }}>{rank.rank.name}</h3>
                </div>
                <div className="rank-xp mono"><CountUp value={xpOf(h)} /> XP</div>
              </div>
              <div className="xp-bar"><i style={{ width: `${rank.progress * 100}%`, background: rank.rank.color }} /></div>
              <p className="muted small">{rank.next ? `${(rank.next.min - xpOf(h)).toLocaleString()} XP to ${rank.next.name}` : "Max rank reached. Legendary."}</p>
              <div className="rank-stats">
                <div><b>{bytes(h.lifetimeFreed)}</b><span>freed</span></div>
                <div><b>{h.boosts}</b><span>boosts</span></div>
                <div><b>{h.scans}</b><span>scans</span></div>
              </div>
            </Card>
          )}
          {s.info && (
            <Card className="rig-card">
              <span className="eyebrow">Your rig</span>
              <h3>{s.info.host || "This PC"}</h3>
              <ul className="rig-list">
                <li><Icon name="cpu" size={16} /> {s.info.cpu}</li>
                <li><Icon name="ram" size={16} /> {bytes(s.info.ram, 0)} RAM</li>
                <li><Icon name="shield" size={16} /> {s.info.os}</li>
              </ul>
            </Card>
          )}
        </div>
      </section>

      {findings && !scanning && <FindingCards f={findings} junk={junk} groups={groups} />}

      <section className="quick-row">
        <QuickAction icon="rocket" color="#ff2bd6" title="Game Boost" text="Max performance before you play" onClick={() => s.go("boost")} />
        <QuickAction icon="gamepad" color="#ffc93c" title="My Games" text="See which games eat your SSD" onClick={() => s.go("games")} />
        <QuickAction icon="gauge" color="#4ef2d0" title="Performance" text="Live CPU, GPU, RAM and ping" onClick={() => s.go("performance")} />
      </section>
    </div>
  );
}

function score(junk: number, startup: StartupItem[] | null, lib: Library | null, drives: Drive[]): number {
  let p = Math.min(35, (junk / 1024 ** 3) * 6);
  p += Math.min(20, (startup?.filter((x) => x.enabled && x.advice === "disable").length ?? 0) * 4);
  p += Math.min(10, ((lib?.leftovers.reduce((a, l) => a + l.size, 0) ?? 0) / 1024 ** 3) * 2);
  const c = drives.find((d) => d.path.toUpperCase().startsWith("C:")) ?? drives[0];
  if (c && c.total > 0) {
    const free = c.free / c.total;
    p += free < 0.1 ? 20 : free < 0.2 ? 10 : 0;
  }
  return Math.max(0, Math.round(100 - p));
}

function ResultOrb({ score, junk }: { score: number; junk: number }) {
  const g = grade(score);
  return (
    <div className="result-orb">
      <Ring value={score / 100} size={240} stroke={14} color={g.color}>
        <span className="grade" style={{ color: g.color, textShadow: `0 0 30px ${g.color}` }}>{g.letter}</span>
        <span className="grade-score mono"><CountUp value={score} /> / 100</span>
      </Ring>
      <p className="grade-text">{g.text}</p>
      {junk > 0 && <p className="muted small">Found <b className="text-lime">{bytes(junk)}</b> of junk ready to clean</p>}
    </div>
  );
}

function FindingCards({ f, junk, groups }: { f: Findings; junk: number; groups: CleanGroup[] | null }) {
  const s = useStore();
  const slow = f.startup?.filter((x) => x.enabled && x.advice === "disable") ?? [];
  const leftovers = f.lib?.leftovers ?? [];
  const leftoverSize = leftovers.reduce((a, l) => a + l.size, 0);
  const minBig = (s.prefs?.largeMinMb ?? 500) * 1024 * 1024;
  const big = (f.big ?? []).filter((b) => b.size >= minBig);
  const sys = f.drives.find((d) => d.path.toUpperCase().startsWith("C:")) ?? f.drives[0];
  const cats = groups?.filter((g) => g.items.some((i) => s.clean.selected.has(`${g.id}|${i.path}`))).length ?? 0;

  return (
    <section className="findings">
      <Card className="finding" glow="#39ff88">
        <div className="finding-head"><Icon name="sparkle" /><span>Junk files</span></div>
        <b className="finding-num text-lime">{groups ? bytes(junk) : "Cleaned"}</b>
        <p>{groups ? `${cats} categories, safe to remove` : "Nice. Run a scan again anytime."}</p>
        <Button small onClick={() => s.go("clean")}>Review</Button>
      </Card>
      <Card className="finding" glow="#7aa8ff">
        <div className="finding-head"><Icon name="power" /><span>Startup hogs</span></div>
        <b className="finding-num" style={{ color: "#7aa8ff" }}>{slow.length}</b>
        <p>{slow.length ? `${slow.slice(0, 3).map((x) => x.name).join(", ")}${slow.length > 3 ? "..." : ""} launch with Windows` : "Your startup is lean"}</p>
        <Button small onClick={() => s.go("startup")}>{slow.length ? "Fix" : "View"}</Button>
      </Card>
      <Card className="finding" glow="#ffc93c">
        <div className="finding-head"><Icon name="gamepad" /><span>Game leftovers</span></div>
        <b className="finding-num text-gold">{bytes(leftoverSize)}</b>
        <p>{leftovers.length ? `${leftovers.length} folders from uninstalled games` : `${f.lib?.games.length ?? 0} games installed, no leftovers`}</p>
        <Button small onClick={() => s.go("games")}>Review</Button>
      </Card>
      <Card className="finding" glow="#ffb020">
        <div className="finding-head"><Icon name="file" /><span>Big files</span></div>
        <b className="finding-num text-amber">{big.length}</b>
        <p>{big.length ? `${bytes(big.reduce((a, b) => a + b.size, 0))} in files over ${bytes(minBig, 0)}` : "No huge files hiding"}</p>
        <Button small onClick={() => s.go("bigfiles")}>Review</Button>
      </Card>
      {sys && (
        <Card className="finding" glow="#00f0ff">
          <div className="finding-head"><Icon name="disk" /><span>{sys.path} drive</span></div>
          <b className="finding-num text-cyan">{bytes(sys.free, 0)}</b>
          <p>free of {bytes(sys.total, 0)}</p>
          <Bar value={1 - sys.free / sys.total} color={sys.free / sys.total < 0.15 ? "var(--red)" : "var(--cyan)"} />
          {sys.free / sys.total < 0.15 && <Badge tone="red" icon="alert">Running low</Badge>}
        </Card>
      )}
    </section>
  );
}

function QuickAction({ icon, color, title, text, onClick }: { icon: "rocket" | "gamepad" | "gauge"; color: string; title: string; text: string; onClick: () => void }) {
  return (
    <Card className="quick-action" glow={color} onClick={onClick}>
      <span className="qa-icon" style={{ "--c": color } as React.CSSProperties}><Icon name={icon} size={22} /></span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
      <Icon name="chevron" size={18} className="muted" />
    </Card>
  );
}
