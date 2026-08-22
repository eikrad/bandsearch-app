import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { AUTH_TOKEN_STORAGE_KEY, E2E_API_BASE_URL } from "./constants.js";

/**
 * Browser coverage for the saved-artists screen.
 *
 * The unit suite drives this screen through the real shell and the real view, but
 * it cannot catch a screen that is unreachable — which is what happened: `#/saved`
 * threw on render while the chat "Saved" button quietly served a second, less
 * capable implementation. These specs assert the screen is reachable and that its
 * controls reach the API.
 *
 * Artists are seeded over HTTP rather than added through the in-app MusicBrainz
 * search, so a run never depends on MusicBrainz being responsive — it throttles at
 * roughly one request per second, and the `@live` specs already pay that cost.
 */
async function seedArtist(page: Page, request: APIRequestContext, name: string) {
  await page.goto("/");
  const token = await page.evaluate((key) => localStorage.getItem(key), AUTH_TOKEN_STORAGE_KEY);
  const response = await request.post(`${E2E_API_BASE_URL}/preferences`, {
    headers: { authorization: `Bearer ${token}` },
    data: { musicbrainzArtistId: `seed-${name}`, name, rating: 4, categories: [], note: "seeded" },
  });
  expect(response.status(), `seeding ${name} failed`).toBe(201);
}

test("navigates from chat to the saved screen", async ({ page, request }) => {
  await seedArtist(page, request, "Codeine");
  await page.goto("/");
  await page.click("text=Saved");
  await expect(page.locator("h1")).toContainText("Saved Artists");
  expect(await page.evaluate(() => location.hash)).toBe("#/saved");
  await expect(page.locator("li", { hasText: "Codeine" }).first()).toBeVisible({ timeout: 15000 });
});

test("loads data on a direct reload of the saved route", async ({ page, request }) => {
  await seedArtist(page, request, "Duster");
  await page.goto("/#/saved");
  await page.reload();
  await expect(page.locator("li", { hasText: "Duster" }).first()).toBeVisible({ timeout: 15000 });
});

test("selects an artist and activates it as a style reference", async ({ page, request }) => {
  await seedArtist(page, request, "Bedhead");
  await page.goto("/#/saved");
  await page.locator("button.tick-btn").first().click();
  await expect(page.locator("text=/\\d+ selected/")).toBeVisible();
  await page.click("button:has-text('Use as style reference')");
  await expect(page.locator("input[name=query]")).toBeVisible();
});

test("creates and deletes a group", async ({ page, request }) => {
  await seedArtist(page, request, "Low");
  await page.goto("/#/saved");
  await page.fill("input[name=create-group]", "Slowcore");
  await page.click("button:has-text('Create')");
  await expect(page.locator("p", { hasText: "Slowcore" }).first()).toBeVisible({ timeout: 15000 });
  // The outer GroupsSection also contains this text, so target the group's own
  // header delete button (×) rather than the first button in any matching section.
  await page.locator("section").filter({ hasText: "Slowcore" }).last().locator("button", { hasText: "×" }).first().click();
  await expect(page.locator("p", { hasText: "Slowcore" })).toHaveCount(0, { timeout: 15000 });
});

test("exports the saved artists", async ({ page, request }) => {
  await seedArtist(page, request, "Bark Psychosis");
  await page.goto("/#/saved");
  const download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("button:has-text('Export')");
  expect((await download).suggestedFilename()).toBe("bandsearch-artists.json");
});

test("deletes a saved artist", async ({ page, request }) => {
  // A name no other spec seeds, so the count assertion below cannot see a duplicate.
  await seedArtist(page, request, "Slint");
  await page.goto("/#/saved");
  const row = page.locator("li", { hasText: "Slint" }).first();
  await expect(row).toBeVisible({ timeout: 15000 });

  // Each row renders the style-reference tick first and the delete control last.
  await row.locator("button").last().click();

  await expect(page.locator("li", { hasText: "Slint" })).toHaveCount(0, { timeout: 15000 });
});
