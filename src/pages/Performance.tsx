import { ReactNode, useEffect, useRef, useState } from "react";
import { invoke, pickFile } from "../api";
import type { Bench, RegionPing, Sample } from "../api";
import { Badge, Bar, Button, Card, Icon, IconName, PinButton, Ring, Segmented, Sparkline, Spinner, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { bytes, cx, duration, num } from "../util";

const N = 60;
const ORDER = ["cpu", "memory", "gpu", "network", "regions", "bench", "cores", "drives", "procs"] as const;
type CardId = (typeof ORDER)[number];
const WIDE: CardId[] = ["regions", "bench", "cores", "drives"];

const pingColor = (ms: number | null | undefined) =>
  ms == null || ms < 0 ? "var(--muted)" : ms < 40 ? "var(--lime)" : ms < 90 ? "var(--amber)" : "var(--red)";

export default function Performance() {
  const s = useStore();
  const [x, setX] = useState<Sample | null>(null);
  const hist = useRef({ cpu: [] as number[], mem: [] as number[], gpu: [] as number[], ping: [] as number[] });
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const v = await invoke<Sample>("status_sample");
        if (!alive) return;
        const h = hist.current;
        const push = (a: number[], n: number) => {
          a.push(n);
          if (a.length > N) a.shift();
        };
        push(h.cpu, v.cpu);
        push(h.mem, (v.memUsed / v.memTotal) * 100);
        push(h.gpu, v.gpu ?? 0);
        if (v.ping !== null && v.ping >= 0) push(h.ping, v.ping);
        setX(v);
      } catch {
        /* keep last sample */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const pinned = (s.prefs?.pinnedCards ?? []).filter((p): p is CardId => (ORDER as readonly string[]).includes(p));
  const order: CardId[] = [...pinned, ...ORDER.filter((c) => !pinned.includes(c))];
  const togglePin = (id: CardId) => s.savePrefs({ pinnedCards: pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id] });

  if (!x) return <div className="page"><ToolHeader icon="gauge" title={L("Performance", "Prestaties")} color="#4ef2d0" /></div>;

  const h = hist.current;
  const memPct = x.memUsed / x.memTotal;
  const procs = [...x.procs].sort((a, b) => (sort === "cpu" ? b.cpu - a.cpu : b.memory - a.memory)).slice(0, 12);
  const pc = pingColor(x.ping);

  const cards: Record<CardId, ReactNode> = {
    cpu: (
      <Meter icon="cpu" label="CPU" value={x.cpu} color="#00f0ff" data={h.cpu}
        detail={x.cpuTemp != null ? `${Math.round(x.cpuTemp)}°C ${L("(approx.)", "(ca.)")} · ${x.cores.length} threads` : `${x.cores.length} threads`} />
    ),
    memory: <Meter icon="ram" label={L("Memory", "Geheugen")} value={memPct * 100} color="#b98cff" data={h.mem} detail={`${bytes(x.memUsed)} / ${bytes(x.memTotal, 0)}`} />,
    gpu: (
      <Meter icon="gpu" label="GPU" value={x.gpu ?? 0} color="#39ff88" data={h.gpu}
        detail={x.gpuExtra
          ? `${x.gpuExtra.temp !== null ? `${Math.round(x.gpuExtra.temp)}°C · ` : ""}${x.gpuExtra.vramUsed ? `${bytes(x.gpuExtra.vramUsed)} VRAM` : ""}`
          : x.gpu === null ? L("Not available", "Niet beschikbaar") : L("3D load", "3D-belasting")} />
    ),
    network: (
      <>
        <div className="meter-body">
          <div className="ping" style={{ color: pc, textShadow: `0 0 18px ${pc}` }}>{x.ping === null ? "--" : x.ping < 0 ? "timeout" : `${x.ping} ms`}</div>
          <span className="muted small">{L("ping to 1.1.1.1", "ping naar 1.1.1.1")}</span>
        </div>
        <Sparkline data={h.ping} color={pc} />
        <div className="meter-foot mono small"><span>↓ {bytes(x.netIn)}/s</span><span>↑ {bytes(x.netOut)}/s</span></div>
      </>
    ),
    regions: <Regions />,
    bench: <Benchmark procs={x.procs.map((p) => p.name)} />,
    cores: (
      <div className="core-bars">
        {x.cores.map((c, i) => (
          <div key={i} className="core" title={`Thread ${i}: ${c.toFixed(0)}%`}>
            <i style={{ height: `${Math.max(2, c)}%`, background: c > 85 ? "var(--red)" : c > 50 ? "var(--amber)" : "var(--cyan)" }} />
          </div>
        ))}
      </div>
    ),
    drives: (
      <>
        {x.disks.map((d) => (
          <div key={d.path} className="drive-line">
            <span className="mono">{d.path}</span>
            <Bar value={1 - d.free / d.total} color={d.free / d.total < 0.1 ? "var(--red)" : "var(--cyan)"} />
            <span className="mono small muted">{bytes(d.free, 0)} {L("free", "vrij")}</span>
          </div>
        ))}
        {x.battery && (
          <div className="drive-line">
            <Icon name="battery" size={16} />
            <Bar value={x.battery[0] / 100} color={x.battery[0] < 20 ? "var(--red)" : "var(--lime)"} />
            <span className="mono small muted">{x.battery[0]}%{x.battery[1] ? L(" charging", " laden") : ""}</span>
          </div>
        )}
      </>
    ),
    procs: (
      <>
        <div className="procs-head">
          <span />
          <Segmented value={sort} onChange={setSort} options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: L("Memory", "Geheugen") }]} />
        </div>
        <table>
          <thead><tr><th>{L("Name", "Naam")}</th><th>PID</th><th>CPU</th><th>{L("Memory", "Geheugen")}</th></tr></thead>
          <tbody>
            {procs.map((p) => (
              <tr key={p.pid}>
                <td className="ellipsis">{p.name}</td>
                <td className="mono muted">{p.pid}</td>
                <td className="mono">{num(p.cpu, 1)}%</td>
                <td className="mono">{bytes(p.memory)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  };

  const meta: Record<CardId, { icon: IconName; title: string }> = {
    cpu: { icon: "cpu", title: "CPU" },
    memory: { icon: "ram", title: L("Memory", "Geheugen") },
    gpu: { icon: "gpu", title: "GPU" },
    network: { icon: "signal", title: L("Network", "Netwerk") },
    regions: { icon: "globe", title: L("Game server regions", "Gameserverregio's") },
    bench: { icon: "gauge", title: L("FPS benchmark", "FPS-benchmark") },
    cores: { icon: "cpu", title: L("Per-thread load", "Belasting per thread") },
    drives: { icon: "disk", title: L("Drives", "Stations") },
    procs: { icon: "bolt", title: L("Top processes", "Topprocessen") },
  };

  return (
    <div className="page">
      <ToolHeader icon="gauge" title={L("Performance", "Prestaties")} color="#4ef2d0" subtitle={`${x.cpuName} · ${L("up", "aan")} ${duration(x.uptime)}`} />
      <section className="perf-grid">
        {order.map((id) => (
          <Card key={id} className={cx("meter", WIDE.includes(id) && "wide", id === "procs" && "full", pinned.includes(id) && "pinned")}>
            <div className="meter-head">
              <Icon name={meta[id].icon} size={18} />
              <span>{meta[id].title}</span>
              <PinButton pinned={pinned.includes(id)} onToggle={() => togglePin(id)} />
            </div>
            {cards[id]}
          </Card>
        ))}
      </section>
    </div>
  );
}

function Meter({ icon, label, value, color, data, detail }: { icon: IconName; label: string; value: number; color: string; data: number[]; detail: string }) {
  return (
    <>
      <div className="meter-body" aria-label={label}>
        <Ring value={value / 100} size={96} stroke={8} color={value > 90 ? "var(--red)" : color}>
          <b className="mono">{Math.round(value)}%</b>
        </Ring>
      </div>
      <Sparkline data={data} max={100} color={color} />
      <div className="meter-foot small muted" data-icon={icon}>{detail}</div>
    </>
  );
}

function Regions() {
  const [r, setR] = useState<RegionPing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setR(await invoke<RegionPing[]>("ping_regions"));
    } catch {
      setR([]);
    }
    setBusy(false);
  };
  useEffect(() => {
    run();
  }, []);
  const sorted = [...(r ?? [])].sort((a, b) => (a.ms ?? 1e9) - (b.ms ?? 1e9));
  const best = sorted[0];
  return (
    <div className="regions">
      {!r ? <Spinner /> : sorted.map((x) => (
        <div key={x.id} className="region">
          <span className="ellipsis">{x.name}</span>
          <Bar value={x.ms == null ? 0 : Math.max(0.03, 1 - x.ms / 300)} color={pingColor(x.ms)} />
          <b className="mono" style={{ color: pingColor(x.ms) }}>{x.ms == null ? "--" : `${x.ms} ms`}</b>
          {x === best && x.ms != null && <Badge tone="lime">{L("Best", "Beste")}</Badge>}
        </div>
      ))}
      <div className="regions-foot">
        <span className="muted small">{L("Connection time to the cloud regions most game servers run in.", "Verbindingstijd naar de cloudregio's waar de meeste gameservers draaien.")}</span>
        <Button small icon="refresh" disabled={busy} onClick={run}>{L("Test again", "Opnieuw testen")}</Button>
      </div>
    </div>
  );
}

function Benchmark({ procs }: { procs: string[] }) {
  const s = useStore();
  const [proc, setProc] = useState("");
  const [secs, setSecs] = useState<"10" | "30" | "60">("30");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [res, setRes] = useState<Bench | null>(null);
  const options = [...new Set(procs.filter((p) => p.toLowerCase().endsWith(".exe")))];

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!s.info?.presentmon) {
    return (
      <div className="bench-setup">
        <p className="muted small">{L("Measures average FPS and 1% / 0.1% lows of a running game, using Intel's free PresentMon tool.", "Meet de gemiddelde FPS en 1% / 0,1% lows van een draaiende game met de gratis PresentMon-tool van Intel.")}</p>
        <div className="row-actions">
          <Button small icon="download" onClick={() => invoke("open_settings", { page: "presentmon" })}>{L("Download PresentMon", "PresentMon downloaden")}</Button>
          <Button small icon="folder" onClick={async () => {
            const p = await pickFile(["exe"], "PresentMon");
            if (p) {
              await s.savePrefs({ presentmonPath: p });
              s.refreshInfo();
            }
          }}>{L("Locate it", "Zoek het op")}</Button>
        </div>
        <p className="muted small">{L("Get the console version (PresentMon-x.y.z-x64.exe).", "Neem de consoleversie (PresentMon-x.y.z-x64.exe).")}</p>
      </div>
    );
  }

  async function start() {
    setBusy(true);
    setRes(null);
    setLeft(Number(secs));
    try {
      setRes(await invoke<Bench>("fps_benchmark", { process: proc, seconds: Number(secs) }));
      s.refreshHistory();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(false);
  }

  return (
    <div className="bench">
      <div className="bench-controls">
        <select value={proc} onChange={(e) => setProc(e.target.value)} disabled={busy}>
          <option value="">{L("Pick your game", "Kies je game")}</option>
          {options.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Segmented value={secs} onChange={setSecs} options={[{ value: "10", label: "10s" }, { value: "30", label: "30s" }, { value: "60", label: "60s" }]} />
        <Button small kind="primary" icon={busy ? undefined : "play"} disabled={!proc || busy} onClick={start}>
          {busy ? <><Spinner size={12} /> {left}s</> : L("Start", "Start")}
        </Button>
      </div>
      {!s.info.isAdmin && <p className="muted small"><Icon name="shield" size={12} /> {L("PresentMon usually needs admin rights.", "PresentMon heeft meestal beheerdersrechten nodig.")}</p>}
      {res && (
        <div className="bench-result">
          <div><b className="text-lime">{num(res.avgFps, 0)}</b><span>{L("avg FPS", "gem. FPS")}</span></div>
          <div><b className="text-amber">{num(res.low1, 0)}</b><span>1% low</span></div>
          <div><b className="text-red">{num(res.low01, 0)}</b><span>0.1% low</span></div>
          <div><b>{num(res.avgMs, 1)}</b><span>{L("ms per frame", "ms per frame")}</span></div>
          <div><b>{num(res.frames)}</b><span>frames</span></div>
        </div>
      )}
    </div>
  );
}
