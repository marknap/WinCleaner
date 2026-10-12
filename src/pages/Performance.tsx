import { useEffect, useRef, useState } from "react";
import { invoke } from "../api";
import type { Sample } from "../api";
import { Bar, Card, Icon, IconName, Ring, Segmented, Sparkline, ToolHeader } from "../components";
import { bytes, duration } from "../util";

const N = 60;

export default function Performance() {
  const [s, setS] = useState<Sample | null>(null);
  const hist = useRef({ cpu: [] as number[], mem: [] as number[], gpu: [] as number[], net: [] as number[], ping: [] as number[] });
  const [sort, setSort] = useState<"cpu" | "memory">("cpu");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const x = await invoke<Sample>("status_sample");
        if (!alive) return;
        const h = hist.current;
        const push = (a: number[], v: number) => {
          a.push(v);
          if (a.length > N) a.shift();
        };
        push(h.cpu, x.cpu);
        push(h.mem, (x.memUsed / x.memTotal) * 100);
        push(h.gpu, x.gpu ?? 0);
        push(h.net, x.netIn);
        if (x.ping !== null && x.ping >= 0) push(h.ping, x.ping);
        setS(x);
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

  const h = hist.current;
  const procs = s ? [...s.procs].sort((a, b) => (sort === "cpu" ? b.cpu - a.cpu : b.memory - a.memory)).slice(0, 12) : [];
  const memPct = s ? s.memUsed / s.memTotal : 0;
  const pingColor = !s?.ping || s.ping < 0 ? "var(--muted)" : s.ping < 40 ? "var(--lime)" : s.ping < 90 ? "var(--amber)" : "var(--red)";

  return (
    <div className="page">
      <ToolHeader icon="gauge" title="Performance" color="#4ef2d0" subtitle={s ? `${s.cpuName} · up ${duration(s.uptime)}` : "Live system stats"} />
      {!s ? null : (
        <>
          <section className="perf-grid">
            <Meter icon="cpu" label="CPU" value={s.cpu} color="#00f0ff" data={h.cpu} max={100} detail={`${s.cores.length} threads`} />
            <Meter icon="ram" label="Memory" value={memPct * 100} color="#b98cff" data={h.mem} max={100} detail={`${bytes(s.memUsed)} / ${bytes(s.memTotal, 0)}`} />
            <Meter
              icon="gpu" label="GPU" value={s.gpu ?? 0} color="#39ff88" data={h.gpu} max={100}
              detail={s.gpuExtra ? `${s.gpuExtra.temp !== null ? `${Math.round(s.gpuExtra.temp)}°C · ` : ""}${s.gpuExtra.vramUsed ? `${bytes(s.gpuExtra.vramUsed)} VRAM` : ""}` : s.gpu === null ? "Not available" : "3D load"}
            />
            <Card className="meter">
              <div className="meter-head"><Icon name="signal" size={18} /><span>Network</span></div>
              <div className="meter-body">
                <div className="ping" style={{ color: pingColor, textShadow: `0 0 18px ${pingColor}` }}>
                  {s.ping === null ? "--" : s.ping < 0 ? "timeout" : `${s.ping} ms`}
                </div>
                <span className="muted small">ping to 1.1.1.1</span>
              </div>
              <Sparkline data={h.ping} color={pingColor} />
              <div className="meter-foot mono small"><span>↓ {bytes(s.netIn)}/s</span><span>↑ {bytes(s.netOut)}/s</span></div>
            </Card>
          </section>

          <section className="perf-row">
            <Card className="cores">
              <div className="meter-head"><Icon name="cpu" size={18} /><span>Per-thread load</span></div>
              <div className="core-bars">
                {s.cores.map((c, i) => (
                  <div key={i} className="core" title={`Thread ${i}: ${c.toFixed(0)}%`}>
                    <i style={{ height: `${Math.max(2, c)}%`, background: c > 85 ? "var(--red)" : c > 50 ? "var(--amber)" : "var(--cyan)" }} />
                  </div>
                ))}
              </div>
            </Card>
            <Card className="drives-card">
              <div className="meter-head"><Icon name="disk" size={18} /><span>Drives</span></div>
              {s.disks.map((d) => (
                <div key={d.path} className="drive-line">
                  <span className="mono">{d.path}</span>
                  <Bar value={1 - d.free / d.total} color={d.free / d.total < 0.1 ? "var(--red)" : "var(--cyan)"} />
                  <span className="mono small muted">{bytes(d.free, 0)} free</span>
                </div>
              ))}
              {s.battery && (
                <div className="drive-line">
                  <Icon name="battery" size={16} />
                  <Bar value={s.battery[0] / 100} color={s.battery[0] < 20 ? "var(--red)" : "var(--lime)"} />
                  <span className="mono small muted">{s.battery[0]}%{s.battery[1] ? " charging" : ""}</span>
                </div>
              )}
            </Card>
          </section>

          <Card className="procs">
            <div className="procs-head">
              <div className="meter-head"><Icon name="bolt" size={18} /><span>Top processes</span></div>
              <Segmented value={sort} onChange={setSort} options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "Memory" }]} />
            </div>
            <table>
              <thead><tr><th>Name</th><th>PID</th><th>CPU</th><th>Memory</th></tr></thead>
              <tbody>
                {procs.map((p) => (
                  <tr key={p.pid}>
                    <td className="ellipsis">{p.name}</td>
                    <td className="mono muted">{p.pid}</td>
                    <td className="mono">{p.cpu.toFixed(1)}%</td>
                    <td className="mono">{bytes(p.memory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function Meter({ icon, label, value, color, data, max, detail }: { icon: IconName; label: string; value: number; color: string; data: number[]; max: number; detail: string }) {
  return (
    <Card className="meter">
      <div className="meter-head"><Icon name={icon} size={18} /><span>{label}</span></div>
      <div className="meter-body">
        <Ring value={value / max} size={96} stroke={8} color={value > 90 ? "var(--red)" : color}>
          <b className="mono">{Math.round(value)}%</b>
        </Ring>
      </div>
      <Sparkline data={data} max={max} color={color} />
      <div className="meter-foot small muted">{detail}</div>
    </Card>
  );
}
