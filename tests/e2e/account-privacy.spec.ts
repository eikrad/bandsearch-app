import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_TOKEN_STORAGE_KEY, E2E_API_BASE_URL } from "./constants.js";

/**
 * Browser coverage for the GDPR controls in Settings.
 *
 * The unit suite proves every seam in the chain — the client calls the endpoint,
 * the app passes the handler, the view receives it — and still could not prove
 * the user gets a file. That gap is exactly how #175 shipped: each part was
 * fine, nothing joined them, and the privacy policy promised Art. 15/20 anyway.
 *
 * These specs run the real API against a real SQLite database with a real
 * registered user, so they exercise the whole path including the download the
 * unit tests cannot reach.
 *
 * What they still do not cover: Tauri's webview. Playwright drives Chromium,
 * which matches WebView2 on Windows but not WebKitGTK on Linux.
 */
async function seedArtist(page: Page, request: APIRequestContext, name: string) {
  await page.goto("/");
  const token = await page.evaluate((key) => localStorage.getItem(key), AUTH_TOKEN_STORAGE_KEY);
  await request.post(`${E2E_API_BASE_URL}/preferences`, {
    headers: { authorization: `Bearer ${token}` },
    data: { musicbrainzArtistId: `mb-${name}`, name, categories: [], note: "" },
  });
}

test("the settings screen offers the export control the privacy policy promises", async ({ page }) => {
  await page.goto("/#/settings");

  // Rendered only when a handler exists (UI_GUIDELINES: no control without an
  // action behind it), so its presence proves the wiring, not just the markup.
  await expect(page.locator("button:has-text('Export my data')")).toBeVisible();
});

test("exporting account data downloads a file", async ({ page }) => {
  await page.goto("/#/settings");

  const download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("button:has-text('Export my data')");

  expect((await download).suggestedFilename()).toBe("bandsearch-account-data.json");
});

test("the exported file contains the user's own saved artists", async ({ page, request }) => {
  await seedArtist(page, request, "Codeine");
  await page.goto("/#/settings");

  const download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("button:has-text('Export my data')");
  const path = await (await download).path();
  const bundle = JSON.parse(await readFile(path, "utf8")) as { savedBands?: { name: string }[] };

  // Art. 15 is about the data actually being there, not about a file arriving.
  expect(bundle.savedBands?.map((b) => b.name)).toContain("Codeine");
});

test("an unrated saved artist survives the export without gaining a rating", async ({ page, request }) => {
  // #164 made an unrated band storable; #167 fixed Number(null) becoming 0 in
  // this very export. A zero here would be a judgement the user never made,
  // handed back to them as their own data.
  await seedArtist(page, request, "Bedhead");
  await page.goto("/#/settings");

  const download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("button:has-text('Export my data')");
  const path = await (await download).path();
  const bundle = JSON.parse(await readFile(path, "utf8")) as { savedBands?: { name: string; rating: number | null }[] };

  const bedhead = bundle.savedBands?.find((b) => b.name === "Bedhead");
  expect(bedhead?.rating ?? null).toBeNull();
});
