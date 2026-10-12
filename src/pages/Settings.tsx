import { useState } from "react";
import { invoke, pickFile, pickPath, pickSave } from "../api";
import type { Prefs } from "../api";
import { Button, Card, Icon, Segmented, Spinner, Toggle, ToolHeader } from "../components";
import { useStore } from "../store";
import { L } from "../i18n";
import { checkForUpdate } from "../updater";
import { date } from "../util";

export default function Settings() {
  const s = useStore();
  const p = s.prefs;
  const [busy, setBusy] = useState<string | null>(null);
  if (!p) return null;

  async function addExclusion(dir: boolean) {
    const path = await pickPath(dir);
    if (path && !p!.excluded.includes(path)) s.savePrefs({ excluded: [...p!.excluded, path] });
  }

  async function task(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      s.toast(String(e), "err");
    }
    setBusy(null);
  }

  const exportSettings = () => task("export", async () => {
    const path = await pickSave("wincleaner-settings.json", ["json"], L("Settings", "Instellingen"));
    if (!path) return;
    await invoke("prefs_export", { path });
    s.toast(L("Settings exported", "Instellingen geëxporteerd"));
  });

  const importSettings = () => task("import", async () => {
    const path = await pickFile(["json"], L("Settings", "Instellingen"));
    if (!path) return;
    await invoke<Prefs>("prefs_import", { path });
    location.reload();
  });

  const exportDiagnostics = () => task("diag", async () => {
    const path = await pickSave("wincleaner-diagnostics.txt", ["txt"], L("Text file", "Tekstbestand"));
    if (!path) return;
    await invoke("diagnostics_export", { path });
    s.toast(L("Diagnostics saved. Send this file along with your bug report.", "Diagnose opgeslagen. Stuur dit bestand mee met je foutmelding."));
  });

  const restorePoint = () => task("restore", async () => {
    const msg = await invoke<string>("restore_point_create");
    s.toast(msg);
    s.savePrefs({});
  });

  const checkUpdates = () => task("update", async () => {
    const u = await checkForUpdate();
    if (u) {
      window.dispatchEvent(new CustomEvent("update-found", { detail: u }));
      s.toast(L(`Version ${u.version} is available. Use the button at the top to install it.`, `Versie ${u.version} is beschikbaar. Gebruik de knop bovenaan om te installeren.`), "info");
    } else s.toast(L("You're on the latest version.", "Je hebt de nieuwste versie."));
  });

  return (
    <div className="page">
      <ToolHeader icon="settings" title={L("Settings", "Instellingen")} color="#8a93b8" subtitle={s.info ? `WinCleaner for Gamers ${s.info.version} · ${s.info.os}` : undefined} />

      <div className="settings">
        <Card>
          <h3>{L("General", "Algemeen")}</h3>
          <Row title={L("Language", "Taal")} text={L("Auto follows your Windows display language.", "Automatisch volgt de weergavetaal van Windows.")}>
            <Segmented value={p.language} onChange={(v) => s.savePrefs({ language: v })} options={[{ value: "auto", label: "Auto" }, { value: "en", label: "English" }, { value: "nl", label: "Nederlands" }]} />
          </Row>
          <Row title={L("Show Pro tools", "Pro-tools tonen")} text={L("Big Files, Duplicates, Uninstaller, Disk Map and History in the sidebar.", "Grote bestanden, Duplicaten, Verwijderen, Schijfkaart en Geschiedenis in de zijbalk.")}>
            <Toggle on={p.proMode} onChange={(v) => s.savePrefs({ proMode: v })} />
          </Row>
          <Row title={L("Keep running in the tray when closed", "In het systeemvak blijven na sluiten")} text={L("Quick Clean and Game Boost stay one right-click away.", "Snel opschonen en Game Boost blijven één rechtsklik verwijderd.")}>
            <Toggle on={p.closeToTray} onChange={(v) => s.savePrefs({ closeToTray: v })} />
          </Row>
          <Row title={L("Updates", "Updates")} text={L("WinCleaner checks for updates when it starts.", "WinCleaner zoekt bij het starten naar updates.")}>
            <Button small icon={busy === "update" ? undefined : "download"} disabled={busy === "update"} onClick={checkUpdates}>
              {busy === "update" ? <Spinner size={12} /> : L("Check now", "Nu controleren")}
            </Button>
          </Row>
        </Card>

        <Card>
          <h3>{L("Cleaning", "Opschonen")}</h3>
          <Row title={L("Send cleaned caches to the Recycle Bin", "Opgeschoonde caches naar de Prullenbak")} text={L("Safer, but space isn't freed until you empty the bin. Big files, duplicates and leftovers always go to the Recycle Bin.", "Veiliger, maar ruimte komt pas vrij als je de Prullenbak leegt. Grote bestanden, duplicaten en restjes gaan altijd naar de Prullenbak.")}>
            <Toggle on={p.cleanToRecycleBin} onChange={(v) => s.savePrefs({ cleanToRecycleBin: v })} />
          </Row>
          <Row title={L("Big file size", "Grootte grote bestanden")} text={L("Big Files shows files larger than this.", "Grote bestanden toont bestanden groter dan dit.")}>
            <select value={p.largeMinMb} onChange={(e) => s.savePrefs({ largeMinMb: Number(e.target.value) })}>
              {[100, 250, 500, 1024, 2048, 5120].map((v) => <option key={v} value={v}>{v >= 1024 ? `${v / 1024} GB` : `${v} MB`}</option>)}
            </select>
          </Row>
          <Row title={L("Old file age", "Leeftijd oude bestanden")} text={L("Files not modified for this long count as old.", "Bestanden die zo lang niet zijn gewijzigd tellen als oud.")}>
            <select value={p.oldDays} onChange={(e) => s.savePrefs({ oldDays: Number(e.target.value) })}>
              {[30, 90, 180, 365, 730].map((v) => <option key={v} value={v}>{v >= 365 ? L(`${v / 365} year${v > 365 ? "s" : ""}`, `${v / 365} jaar`) : L(`${v} days`, `${v} dagen`)}</option>)}
            </select>
          </Row>
          <Row title={L("Clean automatically", "Automatisch opschonen")} text={L("Runs the safe cleanup in the background with Windows Task Scheduler. Only caches and temp files, never your stuff.", "Voert de veilige schoonmaak op de achtergrond uit via Windows Taakplanner. Alleen caches en tijdelijke bestanden, nooit je eigen spullen.")}>
            <Toggle on={p.scheduleEnabled} onChange={(v) => s.savePrefs({ scheduleEnabled: v })} />
          </Row>
          {p.scheduleEnabled && (
            <Row title={L("How often", "Hoe vaak")}>
              <select value={p.scheduleDays} onChange={(e) => s.savePrefs({ scheduleDays: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map((v) => <option key={v} value={v}>{v === 1 ? L("Every day", "Elke dag") : L(`Every ${v} days`, `Elke ${v} dagen`)}</option>)}
              </select>
            </Row>
          )}
        </Card>

        <Card>
          <h3>{L("Safety", "Veiligheid")}</h3>
          <Row title={L("Restore point before changes", "Herstelpunt voor wijzigingen")} text={L("Creates a Windows restore point (at most once a day) before Game Boost or changing gaming settings. Needs admin.", "Maakt een Windows-herstelpunt (maximaal één keer per dag) voor Game Boost of het wijzigen van game-instellingen. Beheerder nodig.")}>
            <Toggle on={p.restorePoints} onChange={(v) => s.savePrefs({ restorePoints: v })} />
          </Row>
          <Row title={L("Create a restore point now", "Nu een herstelpunt maken")} text={p.lastRestorePoint ? L(`Last one: ${date(p.lastRestorePoint)}`, `Laatste: ${date(p.lastRestorePoint)}`) : undefined}>
            {s.info?.isAdmin ? (
              <Button small icon={busy === "restore" ? undefined : "shield"} disabled={busy === "restore"} onClick={restorePoint}>
                {busy === "restore" ? <Spinner size={12} /> : L("Create", "Maken")}
              </Button>
            ) : (
              <Button small icon="shield" onClick={s.restartAdmin}>{L("Restart as admin", "Herstart als beheerder")}</Button>
            )}
          </Row>
          <Row title={L("Windows recovery options", "Windows-herstelopties")}>
            <Button small icon="external" onClick={() => invoke("open_settings", { page: "recovery" })}>{L("Open", "Openen")}</Button>
          </Row>
          <h4 className="sub">{L("Never touch", "Nooit aanraken")}</h4>
          <p className="muted small">{L("WinCleaner will never scan or remove these files and folders. Your saves in Saved Games, Documents\\My Games and AppData are always protected.", "WinCleaner scant of verwijdert deze bestanden en mappen nooit. Je saves in Opgeslagen games, Documenten\\My Games en AppData zijn altijd beschermd.")}</p>
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
            <Button small icon="folder" onClick={() => addExclusion(true)}>{L("Add folder", "Map toevoegen")}</Button>
            <Button small icon="file" onClick={() => addExclusion(false)}>{L("Add file", "Bestand toevoegen")}</Button>
          </div>
        </Card>

        <Card>
          <h3>{L("Advanced", "Geavanceerd")}</h3>
          <Row title={L("Export settings", "Instellingen exporteren")} text={L("Saves your choices and Never-touch list to a file, for another PC or a reinstall.", "Bewaart je keuzes en Nooit-aanraken-lijst in een bestand, voor een andere pc of herinstallatie.")}>
            <Button small icon="upload" disabled={!!busy} onClick={exportSettings}>{L("Export", "Exporteren")}</Button>
          </Row>
          <Row title={L("Import settings", "Instellingen importeren")}>
            <Button small icon="download" disabled={!!busy} onClick={importSettings}>{L("Import", "Importeren")}</Button>
          </Row>
          <Row title={L("Export diagnostics", "Diagnose exporteren")} text={L("A text file with version, settings and the recent log. Handy for bug reports. Contains no personal files.", "Een tekstbestand met versie, instellingen en het recente logboek. Handig bij foutmeldingen. Bevat geen persoonlijke bestanden.")}>
            <Button small icon="file" disabled={!!busy} onClick={exportDiagnostics}>{L("Export", "Exporteren")}</Button>
          </Row>
          <Row title="PresentMon" text={p.presentmonPath ?? (s.info?.presentmon ? L("Found next to WinCleaner", "Gevonden naast WinCleaner") : L("Needed for the FPS benchmark", "Nodig voor de FPS-benchmark"))}>
            <Button small icon="folder" onClick={async () => { const f = await pickFile(["exe"], "PresentMon"); if (f) { await s.savePrefs({ presentmonPath: f }); s.refreshInfo(); } }}>{L("Locate", "Zoeken")}</Button>
          </Row>
          <Row title={s.info?.isAdmin ? L("Running as admin", "Draait als beheerder") : L("Running as a standard user", "Draait als standaardgebruiker")} text={L("Admin rights unlock system temp files, Windows Update leftovers, standby memory and a few advanced fixes.", "Beheerdersrechten ontgrendelen systeembestanden, Windows Update-restjes, standby-geheugen en een paar geavanceerde oplossingen.")}>
            {!s.info?.isAdmin && <Button small icon="shield" onClick={s.restartAdmin}>{L("Restart as admin", "Herstart als beheerder")}</Button>}
          </Row>
          <Row title={L("Windows Game Mode settings", "Windows-instellingen Gamemodus")}>
            <Button small icon="external" onClick={() => invoke("open_settings", { page: "gamemode" })}>{L("Open", "Openen")}</Button>
          </Row>
          <Row title={L("Graphics settings (per-game GPU)", "Grafische instellingen (GPU per game)")}>
            <Button small icon="external" onClick={() => invoke("open_settings", { page: "graphics" })}>{L("Open", "Openen")}</Button>
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
