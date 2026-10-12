import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./api";

export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return await check();
}

/** Downloads, installs and restarts. `onProgress` gets 0..1. */
export async function installUpdate(u: Update, onProgress: (p: number) => void): Promise<void> {
  let total = 0;
  let done = 0;
  await u.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      done += e.data.chunkLength;
      if (total) onProgress(done / total);
    } else if (e.event === "Finished") onProgress(1);
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
