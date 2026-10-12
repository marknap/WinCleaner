import { ReactNode, useEffect, useRef, useState } from "react";
import { bytes, cx } from "./util";
import type { Progress } from "./api";

// ---------------------------------------------------------------------------
// Icons (24px stroke icons)
// ---------------------------------------------------------------------------

const P: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  sparkle: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z",
  rocket: "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2 M9 15l-3-3c1-4 4.5-8 12-9-1 7.5-5 11-9 12z M13 9.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  gamepad: "M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.4 1.8L15 15H9l-1.6 1.8A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4z M7 10.5v3 M5.5 12h3 M16 11h.01 M18 13h.01",
  power: "M12 3v8 M6.3 6.3a8 8 0 1 0 11.4 0",
  gauge: "M4 18a9 9 0 1 1 16 0 M12 14l4-5",
  file: "M6 3h8l4 4v14H6z M14 3v4h4",
  copy: "M8 8h12v12H8z M4 16V4h12",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  package: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10",
  map: "M3 3h8v10H3z M13 3h8v6h-8z M13 11h8v10h-8z M3 15h8v6H3z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2",
  settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9L7 7 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12 M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  back: "M15 6l-6 6 6 6",
  folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  play: "M7 4l13 8-13 8z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  cpu: "M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4",
  ram: "M3 7h18v8H3z M7 15v3 M11 15v3 M15 15v3 M7 10v2 M11 10v2 M15 10v2",
  gpu: "M2 6h18v11H2z M20 9h2 M20 14h2 M5.5 11.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M12 11.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
  wifi: "M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01",
  disk: "M3 12h18 M5 5h14l2 7v6H3v-6z M17 15h.01",
  battery: "M3 8h15v8H3z M20 11v2",
  search: "M4 10.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0 M20 20l-4.5-4.5",
  refresh: "M20 11a8 8 0 0 0-14.9-3.5L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14.9 3.5L20 15 M20 20v-5h-5",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
  lock: "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  alert: "M12 3l10 18H2z M12 10v5 M12 18h.01",
  star: "M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0z M8 6H4a3 3 0 0 0 4 4 M16 6h4a3 3 0 0 1-4 4 M12 13v4 M9 17h6v4H9z",
  info: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 11v5 M12 8h.01",
  undo: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  signal: "M4 20v-3 M9 20v-7 M14 20V9 M19 20V5",
  minimize: "M5 12h14",
  maximize: "M5 5h14v14H5z",
  plus: "M12 5v14 M5 12h14",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 7v5l3 2",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={cx("icon", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Basic controls
// ---------------------------------------------------------------------------

export function Button({ children, onClick, kind = "ghost", icon, disabled, small, title, className }: {
  children?: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger" | "subtle"; icon?: IconName;
  disabled?: boolean; small?: boolean; title?: string; className?: string;
}) {
  return (
    <button className={cx("btn", `btn-${kind}`, small && "btn-sm", className)} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={small ? 15 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Toggle({ on, onChange, disabled, title }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button role="switch" aria-checked={on} title={title} className={cx("toggle", on && "on")} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Check({ state, onChange, disabled }: { state: boolean | "mixed"; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state}
      className={cx("check", state === true && "on", state === "mixed" && "mixed")}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(state !== true);
      }}
    >
      {state === true && <Icon name="check" size={13} />}
      {state === "mixed" && <span className="dash" />}
    </button>
  );
}

export function Badge({ children, tone = "muted", icon }: { children: ReactNode; tone?: "muted" | "cyan" | "pink" | "lime" | "amber" | "red"; icon?: IconName }) {
  return (
    <span className={cx("badge", `tone-${tone}`)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Card({ children, className, glow, onClick }: { children: ReactNode; className?: string; glow?: string; onClick?: () => void }) {
  return (
    <div className={cx("card", onClick && "clickable", className)} style={glow ? ({ "--glow": glow } as React.CSSProperties) : undefined} onClick={onClick}>
      {children}
    </div>
  );
}

export function Disclosure({ title, children, defaultOpen = false, count }: { title: string; children: ReactNode; defaultOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cx("disclosure", open && "open")}>
      <button className="disclosure-head" onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={16} className="chev" />
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}

export function Search({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear">
          <Icon name="x" size={14} />
        </button>
      )}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={cx(o.value === value && "on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------

export function ToolHeader({ icon, title, subtitle, color, children }: { icon: IconName; title: string; subtitle?: ReactNode; color: string; children?: ReactNode }) {
  return (
    <header className="tool-header">
      <div className="tool-icon" style={{ "--c": color } as React.CSSProperties}>
        <Icon name={icon} size={24} />
      </div>
      <div className="tool-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="tool-actions">{children}</div>
    </header>
  );
}

export function EmptyStart({ icon, title, text, action, onAction, color }: { icon: IconName; title: string; text: string; action: string; onAction: () => void; color: string }) {
  return (
    <div className="empty-start" style={{ "--c": color } as React.CSSProperties}>
      <div className="empty-orb">
        <Icon name={icon} size={44} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <Button kind="primary" icon="bolt" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

export function ScanProgress({ progress, onCancel, title }: { progress: Progress | null; onCancel?: () => void; title?: string }) {
  return (
    <div className="scan-progress">
      <div className="radar">
        <div className="sweep" />
        <div className="blip b1" />
        <div className="blip b2" />
        <div className="blip b3" />
      </div>
      <h2>{progress?.phase || title || "Scanning"}</h2>
      <p className="mono path">{progress?.current || "\u00a0"}</p>
      <div className="scan-stats">
        <div>
          <b>{bytes(progress?.bytes ?? 0)}</b>
          <span>scanned</span>
        </div>
        <div>
          <b>{(progress?.items ?? 0).toLocaleString()}</b>
          <span>files</span>
        </div>
      </div>
      {onCancel && (
        <Button icon="x" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <footer className="action-bar">
      <div className="note">{note}</div>
      <div className="actions">{children}</div>
    </footer>
  );
}

export function Banner({ tone = "amber", icon = "alert", children, action }: { tone?: "amber" | "cyan" | "pink" | "red"; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("banner", `tone-${tone}`)}>
      <Icon name={icon} size={18} />
      <div className="banner-text">{children}</div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export function Ring({ value, size = 120, stroke = 10, color = "var(--cyan)", children, track = "rgba(255,255,255,.06)" }: {
  value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset .6s ease", filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Donut({ parts, size = 200, stroke = 22, children }: { parts: { value: number; color: string }[]; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let offset = 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.05)" strokeWidth={stroke} fill="none" />
        {parts.filter((p) => p.value > 0).map((p, i) => {
          const len = (p.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={p.color} strokeWidth={stroke} fill="none"
              strokeDasharray={`${Math.max(len - 3, 1)} ${c}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "all .5s ease", filter: `drop-shadow(0 0 4px ${p.color})` }} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Sparkline({ data, max, color = "var(--cyan)", height = 56 }: { data: number[]; max?: number; color?: string; height?: number }) {
  const w = 240;
  const m = max ?? Math.max(1, ...data);
  const n = Math.max(data.length, 2);
  const pts = data.map((v, i) => [(i / (n - 1)) * w, height - (Math.min(v, m) / m) * (height - 4) - 2]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const id = useRef(`g${Math.random().toString(36).slice(2)}`).current;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <>
          <path d={`${line} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

export function Bar({ value, color = "var(--cyan)" }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
    </div>
  );
}

/** Animated number that eases toward its target. */
export function CountUp({ value, format = (v: number) => Math.round(v).toLocaleString() }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

/** Confetti-like burst for wins. */
export function Burst({ trigger }: { trigger: number }) {
  if (!trigger) return null;
  return (
    <div className="burst" key={trigger} aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} style={{ "--a": `${(i / 28) * 360}deg`, "--d": `${80 + (i % 5) * 30}px`, "--c": ["#00f0ff", "#ff2bd6", "#39ff88", "#ffc93c"][i % 4] } as React.CSSProperties} />
      ))}
    </div>
  );
}
