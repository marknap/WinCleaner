import { useEffect, useState } from "react";
import { invoke } from "../api";
import type { StartupItem } from "../api";
import { Badge, Banner, Button, Card, Disclosure, Icon, Spinner, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
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
      if (!quiet) s.toast(enabled ? L(`${it.name} will start with Windows`, `${it.name} start mee met Windows`) : L(`${it.name} won't start with Windows anymore`, `${it.name} start niet meer mee met Windows`));
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(null);
  }

  async function disableRecommended() {
    const list = (items ?? []).filter((x) => x.enabled && x.advice === "disable" && (!x.needsAdmin || s.info?.isAdmin));
    for (const it of list) await set(it, false, true);
    s.toast(L(`Disabled ${list.length} startup apps. Faster boot unlocked!`, `${list.length} opstartapps uitgezet. Sneller opstarten ontgrendeld!`));
    if (list.length) s.celebrate();
    s.refreshHistory();
  }

  const admin = s.info?.isAdmin ?? false;
  const recommended = (items ?? []).filter((x) => x.enabled && x.advice === "disable");
  const optional = (items ?? []).filter((x) => x.advice === "optional" || x.advice === "unknown" || (x.advice === "disable" && !x.enabled));
  const keep = (items ?? []).filter((x) => x.advice === "keep");
  const enabledCount = (items ?? []).filter((x) => x.enabled).length;

  return (
    <div className="page">
      <ToolHeader icon="power" title={L("Startup", "Opstarten")} color="#7aa8ff" subtitle={items ? L(`${enabledCount} apps start with Windows`, `${enabledCount} apps starten mee met Windows`) : L("Apps that launch when you sign in", "Apps die starten als je inlogt")}>
        <Button icon="external" onClick={() => invoke("open_settings", { page: "startupapps" })}>{L("Windows settings", "Windows-instellingen")}</Button>
      </ToolHeader>

      {!items ? (
        <div className="center-pad"><Spinner size={32} /></div>
      ) : (
        <>
          <Banner tone="cyan" icon="info">
            {L("Disabling only stops an app from launching at sign-in. Nothing is uninstalled, and you can switch it back anytime.", "Uitzetten voorkomt alleen dat een app start bij het inloggen. Er wordt niets verwijderd en je kunt het altijd terugzetten.")}
          </Banner>

          {recommended.length > 0 && (
            <Card className="startup-hero" glow="#7aa8ff">
              <div>
                <h3>{L(`${recommended.length} apps slow down your boot`, `${recommended.length} apps vertragen je opstart`)}</h3>
                <p className="muted">{L("Launchers and chat apps open fine when you need them.", "Launchers en chatapps openen prima wanneer je ze nodig hebt.")}</p>
              </div>
              <Button kind="primary" icon="bolt" onClick={disableRecommended}>{L(`Disable all ${recommended.length}`, `Alle ${recommended.length} uitzetten`)}</Button>
            </Card>
          )}

          <List title={L("Safe to disable", "Veilig uit te zetten")} tone="lime" items={recommended} busy={busy} admin={admin} onSet={set} />
          <List title={L("Your call", "Jij beslist")} tone="amber" items={optional} busy={busy} admin={admin} onSet={set} />
          <Disclosure title={L("Keep these on", "Laat deze aan")} count={keep.length}>
            <List items={keep} busy={busy} admin={admin} onSet={set} />
          </Disclosure>
          {!admin && (items ?? []).some((x) => x.needsAdmin) && (
            <p className="muted small"><Icon name="lock" size={13} /> {L("Items for all users need admin.", "Items voor alle gebruikers hebben beheerdersrechten nodig.")} <button className="link" onClick={s.restartAdmin}>{L("Restart as admin", "Herstart als beheerder")}</button></p>
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
              {it.needsAdmin && <Badge tone="cyan" icon="shield">{L("All users", "Alle gebruikers")}</Badge>}
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
