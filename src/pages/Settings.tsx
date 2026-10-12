import { invoke, pickPath } from "../api";
import { Button, Card, Icon, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";

export default function Settings() {
  const s = useStore();
  const p = s.prefs;
  if (!p) return null;

  async function addExclusion(dir: boolean) {
    const path = await pickPath(dir);
    if (path && !p!.excluded.includes(path)) s.savePrefs({ excluded: [...p!.excluded, path] });
  }

  return (
    <div className="page">
      <ToolHeader icon="settings" title="Settings" color="#8a93b8" subtitle={s.info ? `WinCleaner for Gamers ${s.info.version} · ${s.info.os}` : undefined} />

      <div className="settings">
        <Card>
          <h3>Cleaning</h3>
          <Row title="Send cleaned caches to the Recycle Bin" text="Safer, but space isn't freed until you empty the bin. Big files, duplicates and leftovers always go to the Recycle Bin.">
            <Toggle on={p.cleanToRecycleBin} onChange={(v) => s.savePrefs({ cleanToRecycleBin: v })} />
          </Row>
          <Row title="Big file size" text="Big Files shows files larger than this.">
            <select value={p.largeMinMb} onChange={(e) => s.savePrefs({ largeMinMb: Number(e.target.value) })}>
              {[100, 250, 500, 1024, 2048, 5120].map((v) => <option key={v} value={v}>{v >= 1024 ? `${v / 1024} GB` : `${v} MB`}</option>)}
            </select>
          </Row>
          <Row title="Old file age" text="Files not modified for this long count as old.">
            <select value={p.oldDays} onChange={(e) => s.savePrefs({ oldDays: Number(e.target.value) })}>
              {[30, 90, 180, 365, 730].map((v) => <option key={v} value={v}>{v >= 365 ? `${v / 365} year${v > 365 ? "s" : ""}` : `${v} days`}</option>)}
            </select>
          </Row>
        </Card>

        <Card>
          <h3>Autopilot</h3>
          <Row title="Clean automatically" text="Runs the safe cleanup in the background with Windows Task Scheduler. Only caches and temp files, never your stuff.">
            <Toggle on={p.scheduleEnabled} onChange={(v) => s.savePrefs({ scheduleEnabled: v })} />
          </Row>
          {p.scheduleEnabled && (
            <Row title="How often">
              <select value={p.scheduleDays} onChange={(e) => s.savePrefs({ scheduleDays: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map((v) => <option key={v} value={v}>{v === 1 ? "Every day" : `Every ${v} days`}</option>)}
              </select>
            </Row>
          )}
          <Row title="Keep running in the tray when closed" text="Quick Clean and Game Boost stay one right-click away.">
            <Toggle on={p.closeToTray} onChange={(v) => s.savePrefs({ closeToTray: v })} />
          </Row>
          <Row title="Show Pro tools" text="Big Files, Duplicates, Uninstaller, Disk Map and History in the sidebar.">
            <Toggle on={p.proMode} onChange={(v) => s.savePrefs({ proMode: v })} />
          </Row>
        </Card>

        <Card>
          <h3>Never touch</h3>
          <p className="muted small">WinCleaner will never scan or remove these files and folders. Your saves in Saved Games, Documents\My Games and AppData are always protected.</p>
          <div className="excl-list">
            {p.excluded.map((e) => (
              <div key={e} className="item-row">
                <Icon name="lock" size={14} />
                <span className="mono small ellipsis">{e}</span>
                <Button small kind="subtle" icon="x" onClick={() => s.savePrefs({ excluded: p.excluded.filter((x) => x !== e) })} />
              </div>
            ))}
          </div>
          <div className="row-actions">
            <Button small icon="folder" onClick={() => addExclusion(true)}>Add folder</Button>
            <Button small icon="file" onClick={() => addExclusion(false)}>Add file</Button>
          </div>
        </Card>

        <Card>
          <h3>Permissions</h3>
          <Row title={s.info?.isAdmin ? "Running as admin" : "Running as a standard user"} text="Admin rights unlock system temp files, Windows Update leftovers, standby memory and a few advanced fixes.">
            {!s.info?.isAdmin && <Button small icon="shield" onClick={s.restartAdmin}>Restart as admin</Button>}
          </Row>
          <Row title="Windows Game Mode settings">
            <Button small icon="external" onClick={() => invoke("open_settings", { page: "gamemode" })}>Open</Button>
          </Row>
          <Row title="Graphics settings (per-game GPU)">
            <Button small icon="external" onClick={() => invoke("open_settings", { page: "graphics" })}>Open</Button>
          </Row>
        </Card>
      </div>
    </div>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <b>{title}</b>
        {text && <p className="muted small">{text}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
