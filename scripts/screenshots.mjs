// Captures README screenshots from the UI preview (sample data from src/mock.ts).
// Usage: npm run dev (in another terminal), then npm run screenshots
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.URL ?? "http://localhost:1420/";
const OUT = new globalThis.URL("../docs/screenshots/", import.meta.url).pathname;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const nav = (label) => page.locator(".nav-item", { hasText: label }).first().click();
const shot = async (name, wait = 900) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`saved ${name}.png`);
};

await page.goto(URL);
await page.waitForTimeout(5500); // let first-run achievement toasts fade

await page.locator(".scan-orb").click();
await shot("01-home", 5500);

await nav("Clean");
await page.locator(".cat-row", { hasText: "Steam web cache" }).click();
await shot("02-clean");

await nav("Game Boost");
await page.locator(".boost-btn").click();
await shot("03-game-boost", 2500);

await nav("My Games");
await shot("04-my-games", 1800);
await page.locator(".game-grid").scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 300);
await shot("05-game-library", 2500);

await nav("Startup");
await shot("06-startup");

await nav("Performance");
await shot("07-performance", 8000);

await page.locator(".nav-section").click();
await nav("Disk Map");
await page.locator(".drive-tile").first().click();
await shot("08-disk-map", 2000);

await nav("History");
await shot("09-history");

await nav("Settings");
await page.getByRole("button", { name: "Nederlands" }).click();
await page.waitForTimeout(800);
await nav("Home");
await shot("10-dutch", 1200);

await browser.close();
