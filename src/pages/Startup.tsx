import { useEffect, useState } from "react";
import { invoke } from "../api";
import type { StartupItem } from "../api";
import { Badge, Banner, Button, Card, Disclosure, Icon, Spinner, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";
import { cx } from "../util";

export default function Startup() {
  const s = useStore();
  const [items, setItems] = useState<StartupItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => invoke<StartupItem[]>("startup_list").then(setItems).catch((e) => s.toast(String(e), "err"));
  useEffect(() => {
    load();
  }, []);

  async function set(it: StartupItem, enabled: boolean, quiet = false) {
    setBusy(it.id);
    try {
      await invoke("startup_set", { id: it.id, enabled });
      setItems((xs) => xs && xs.map((x) => (x.id === it.id ? { ...x, enabled } : x)));
      if (!quiet) s.toast(`${it.name} ${enabled ? "will start with Windows" : "won't start with Windows anymore"}`);
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(null);
  }

  async function disableRecommended() {
    const list = (items ?? []).filter((x) => x.enabled && x.advice === "disable" && (!x.needsAdmin || s.info?.isAdmin));
    for (const it of list) await set(it, false, true);
    s.toast(`Disabled ${list.length} startup apps. Faster boot unlocked!`);
    if (list.length) s.celebrate();
  }

  const admin = s.info?.isAdmin ?? false;
  const recommended = (items ?? []).filter((x) => x.enabled && x.advice === "disable");
  const optional = (items ?? []).filter((x) => x.advice === "optional" || x.advice === "unknown" || (x.advice === "disable" && !x.enabled));
  const keep = (items ?? []).filter((x) => x.advice === "keep");
  const enabledCount = (items ?? []).filter((x) => x.enabled).length;

  return (
    <div className="page">
      <ToolHeader icon="power" title="Startup" color="#7aa8ff" subtitle={items ? `${enabledCount} apps start with Windows` : "Apps that launch when you sign in"}>
        <Button icon="external" onClick={() => invoke("open_settings", { page: "startupapps" })}>Windows settings</Button>
      </ToolHeader>

      {!items ? (
        <div className="center-pad"><Spinner size={32} /></div>
      ) : (
        <>
          <Banner tone="cyan" icon="info">
            Disabling only stops an app from launching at sign-in. Nothing is uninstalled, and you can switch it back anytime.
          </Banner>

          {recommended.length > 0 && (
            <Card className="startup-hero" glow="#7aa8ff">
              <div>
                <h3>{recommended.length} apps slow down your boot</h3>
                <p className="muted">Launchers and chat apps open fine when you need them.</p>
              </div>
              <Button kind="primary" icon="bolt" onClick={disableRecommended}>Disable all {recommended.length}</Button>
            </Card>
          )}

          <List title="Safe to disable" tone="lime" items={recommended} busy={busy} admin={admin} onSet={set} />
          <List title="Your call" tone="amber" items={optional} busy={busy} admin={admin} onSet={set} />
          <Disclosure title="Keep these on" count={keep.length}>
            <List items={keep} busy={busy} admin={admin} onSet={set} />
          </Disclosure>
          {!admin && (items ?? []).some((x) => x.needsAdmin) && (
            <p className="muted small"><Icon name="lock" size={13} /> Items for all users need admin. <button className="link" onClick={s.restartAdmin}>Restart as admin</button></p>
          )}
        </>
      )}
    </div>
  );
}

function List({ title, tone, items, busy, admin, onSet }: {
  title?: string; tone?: "lime" | "amber"; items: StartupItem[]; busy: string | null; admin: boolean; onSet: (it: StartupItem, v: boolean) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="startup-section">
      {title && <h4 className={cx("section-label", tone && `text-${tone}`)}>{title}</h4>}
      {items.map((it) => (
        <div key={it.id} className={cx("startup-row", !it.enabled && "off")}>
          <span className="app-avatar">{it.name.slice(0, 1).toUpperCase()}</span>
          <div className="startup-text">
            <div className="startup-name">
              {it.name}
              {it.needsAdmin && <Badge tone="cyan" icon="shield">All users</Badge>}
            </div>
            {it.adviceText && <p>{it.adviceText}</p>}
            <p className="mono muted small ellipsis" title={it.command}>{it.command}</p>
          </div>
          {busy === it.id ? <Spinner /> : <Toggle on={it.enabled} disabled={it.needsAdmin && !admin} onChange={(v) => onSet(it, v)} />}
        </div>
      ))}
    </section>
  );
}
