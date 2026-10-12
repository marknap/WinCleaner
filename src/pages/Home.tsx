import { useEffect, useRef, useState } from "react";
import { invoke } from "../api";
import type { ActionResult, CleanGroup, Drive, FileEntry, Library, StartupItem } from "../api";
import { Badge, Banner, Bar, Button, Card, CountUp, Icon, Ring, Spinner } from "../components";
import { defaultSelection, selectedTargets, useStore } from "../store";
import { L } from "../i18n";
import { weekStreak } from "../achievements";
import { bytes, grade, num, rankName, rankOf, xpOf } from "../util";

interface Findings {
  lib: Library | null;
  startup: StartupItem[] | null;
  big: FileEntry[] | null;
  drives: Drive[];
  score: number;
}

// Survives page switches for the lifetime of the window.
let cached: Findings | null = null;

const STEPS = () => [L("Junk & caches", "Rommel en caches"), L("Game library", "Gamebibliotheek"), L("Startup apps", "Opstartapps"), L("Big files", "Grote bestanden")];

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
    const targets = selectedTargets(groups, s.clean.selected);
    if (!(await s.confirmPermanent(targets))) return;
    setCleaning(true);
    try {
      const r = await invoke<ActionResult>("clean_run", { targets, tool: "smart" });
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
        const targets = selectedTargets(g, defaultSelection(g));
        if (await s.confirmPermanent(targets)) {
          const r = await invoke<ActionResult>("clean_run", { targets, tool: "quick" });
          s.toast(r.message);
          if (r.freed > 0) s.celebrate();
          s.refreshHistory();
        }
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
  const streak = h ? weekStreak(h) : 0;

  return (
    <div className="page home">
      {s.info && !s.info.isAdmin && (
        <Banner tone="cyan" icon="shield" action={<Button small icon="shield" onClick={s.restartAdmin}>{L("Restart as admin", "Herstart als beheerder")}</Button>}>
          <b>{L("Unlock full power.", "Ontgrendel alles.")}</b>{" "}
          {L("Windows Update leftovers, old Windows installs, system crash dumps and a few boosts need admin rights.", "Windows Update-restjes, oude Windows-installaties, systeemcrashdumps en een paar boosts hebben beheerdersrechten nodig.")}
        </Banner>
      )}

      <section className="hero">
        <div className="hero-main">
          {scanning ? (
            <div className="scan-orb scanning">
              <div className="orb-ring" />
              <div className="orb-core">
                <Spinner size={28} />
                <b>{STEPS()[step]}</b>
                <span className="mono small">{bytes(s.progress?.bytes ?? 0)} {L("checked", "gecontroleerd")}</span>
              </div>
            </div>
          ) : findings && cleanedNow === null && groups ? (
            <ResultOrb score={findings.score} junk={junk} />
          ) : (
            <button className="scan-orb" onClick={scan} disabled={cleaning}>
              <div className="orb-ring" />
              <div className="orb-core">
                <Icon name="bolt" size={40} />
                <b>{findings ? L("SCAN AGAIN", "OPNIEUW") : "SCAN"}</b>
                <span>{cleanedNow !== null ? L(`Freed ${bytes(cleanedNow)} · GG!`, `${bytes(cleanedNow)} vrijgemaakt · GG!`) : L("One click checkup", "Check in één klik")}</span>
              </div>
            </button>
          )}
          {(scanning || !findings || !groups) && (
            <div className="hero-steps">
              {STEPS().map((label, i) => (
                <span key={label} className={step === i ? "active" : step > i ? "done" : ""}>
                  {step > i ? <Icon name="check" size={13} /> : <i />} {label}
                </span>
              ))}
            </div>
          )}
          {scanning && <Button small icon="x" onClick={cancel}>{L("Cancel", "Annuleren")}</Button>}
          {!scanning && findings && groups && (
            <div className="hero-cta">
              <Button kind="primary" icon="sparkle" onClick={cleanNow} disabled={cleaning || junk === 0}>
                {cleaning ? L("Cleaning...", "Opschonen...") : junk > 0 ? L(`Clean ${bytes(junk)}`, `${bytes(junk)} opschonen`) : L("Nothing to clean", "Niets op te schonen")}
              </Button>
              <Button icon="refresh" onClick={scan}>{L("Rescan", "Opnieuw scannen")}</Button>
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
                  <span className="eyebrow">{L("Your rank", "Jouw rang")}</span>
                  <h3 style={{ color: rank.rank.color }}>{rankName(rank.rank)}</h3>
                </div>
                <div className="rank-xp mono"><CountUp value={xpOf(h)} /> XP</div>
              </div>
              <div className="xp-bar"><i style={{ width: `${rank.progress * 100}%`, background: rank.rank.color }} /></div>
              <p className="muted small">
                {rank.next ? L(`${num(rank.next.min - xpOf(h))} XP to ${rankName(rank.next)}`, `Nog ${num(rank.next.min - xpOf(h))} XP tot ${rankName(rank.next)}`) : L("Max rank reached. Legendary.", "Hoogste rang bereikt. Legendarisch.")}
              </p>
              <div className="rank-stats">
                <div><b>{bytes(h.lifetimeFreed)}</b><span>{L("freed", "vrijgemaakt")}</span></div>
                <div><b>{h.boosts}</b><span>boosts</span></div>
                <div className={streak > 0 ? "streak" : ""}>
                  <b>{streak > 0 && <Icon name="flame" size={14} />} {streak}</b>
                  <span>{L("week streak", "weken op rij")}</span>
                </div>
              </div>
            </Card>
          )}
          {s.info && (
            <Card className="rig-card">
              <span className="eyebrow">{L("Your rig", "Jouw rig")}</span>
              <h3>{s.info.host || L("This PC", "Deze pc")}</h3>
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
        <QuickAction icon="rocket" color="#ff2bd6" title="Game Boost" text={L("Max performance before you play", "Maximale prestaties voor je gaat spelen")} onClick={() => s.go("boost")} />
        <QuickAction icon="gamepad" color="#ffc93c" title={L("My Games", "Mijn games")} text={L("See which games eat your SSD", "Zie welke games je SSD opeten")} onClick={() => s.go("games")} />
        <QuickAction icon="gauge" color="#4ef2d0" title={L("Performance", "Prestaties")} text={L("Live CPU, GPU, RAM and ping", "Live CPU, GPU, RAM en ping")} onClick={() => s.go("performance")} />
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
      {junk > 0 && <p className="muted small">{L("Found", "Gevonden:")} <b className="text-lime">{bytes(junk)}</b> {L("of junk ready to clean", "rommel klaar om op te ruimen")}</p>}
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
  const review = L("Review", "Bekijken");

  return (
    <section className="findings">
      <Card className="finding" glow="#39ff88">
        <div className="finding-head"><Icon name="sparkle" /><span>{L("Junk files", "Rommel")}</span></div>
        <b className="finding-num text-lime">{groups ? bytes(junk) : L("Cleaned", "Opgeruimd")}</b>
        <p>{groups ? L(`${cats} categories, safe to remove`, `${cats} categorieën, veilig te verwijderen`) : L("Nice. Run a scan again anytime.", "Netjes. Scan gerust nog eens.")}</p>
        <Button small onClick={() => s.go("clean")}>{review}</Button>
      </Card>
      <Card className="finding" glow="#7aa8ff">
        <div className="finding-head"><Icon name="power" /><span>{L("Startup hogs", "Opstartvreters")}</span></div>
        <b className="finding-num" style={{ color: "#7aa8ff" }}>{slow.length}</b>
        <p>{slow.length ? L(`${slow.slice(0, 3).map((x) => x.name).join(", ")}${slow.length > 3 ? "..." : ""} launch with Windows`, `${slow.slice(0, 3).map((x) => x.name).join(", ")}${slow.length > 3 ? "..." : ""} starten met Windows`) : L("Your startup is lean", "Je opstart is lekker licht")}</p>
        <Button small onClick={() => s.go("startup")}>{slow.length ? L("Fix", "Oplossen") : L("View", "Bekijken")}</Button>
      </Card>
      <Card className="finding" glow="#ffc93c">
        <div className="finding-head"><Icon name="gamepad" /><span>{L("Game leftovers", "Game-restjes")}</span></div>
        <b className="finding-num text-gold">{bytes(leftoverSize)}</b>
        <p>{leftovers.length ? L(`${leftovers.length} folders from uninstalled games`, `${leftovers.length} mappen van verwijderde games`) : L(`${f.lib?.games.length ?? 0} games installed, no leftovers`, `${f.lib?.games.length ?? 0} games geïnstalleerd, geen restjes`)}</p>
        <Button small onClick={() => s.go("games")}>{review}</Button>
      </Card>
      <Card className="finding" glow="#ffb020">
        <div className="finding-head"><Icon name="file" /><span>{L("Big files", "Grote bestanden")}</span></div>
        <b className="finding-num text-amber">{big.length}</b>
        <p>{big.length ? L(`${bytes(big.reduce((a, b) => a + b.size, 0))} in files over ${bytes(minBig, 0)}`, `${bytes(big.reduce((a, b) => a + b.size, 0))} in bestanden boven ${bytes(minBig, 0)}`) : L("No huge files hiding", "Geen enorme bestanden gevonden")}</p>
        <Button small onClick={() => s.go("bigfiles")}>{review}</Button>
      </Card>
      {sys && (
        <Card className="finding" glow="#00f0ff">
          <div className="finding-head"><Icon name="disk" /><span>{L(`${sys.path} drive`, `Station ${sys.path}`)}</span></div>
          <b className="finding-num text-cyan">{bytes(sys.free, 0)}</b>
          <p>{L(`free of ${bytes(sys.total, 0)}`, `vrij van ${bytes(sys.total, 0)}`)}</p>
          <Bar value={1 - sys.free / sys.total} color={sys.free / sys.total < 0.15 ? "var(--red)" : "var(--cyan)"} />
          {sys.free / sys.total < 0.15 && <Badge tone="red" icon="alert">{L("Running low", "Bijna vol")}</Badge>}
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
