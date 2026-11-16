import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { AUTH_TOKEN_STORAGE_KEY, E2E_API_BASE_URL } from "./constants.js";

test.setTimeout(30_000);

test("saving an earlier card uses that card's artist identity and rationale", async ({ page }) => {
  const firstId = randomUUID();
  const secondId = randomUUID();
  let turn = 0;
  await page.route("**/recommendations", (route) => {
    const current = turn++;
    return route.fulfill({ json: {
      recommendations: [{
        artist: "Odessa",
        musicbrainzArtistId: current === 0 ? firstId : secondId,
        why: current === 0 ? "The earlier atmospheric artist." : "The later electronic artist.",
        sourceSignals: ["musicbrainz_search"],
      }],
      assistantReply: "Here is an artist to explore.",
      meta: { modeUsed: "fresh", usedPreferenceContext: false },
    } });
  });
  await page.goto("/");
  await page.fill("input[name=query]", "atmospheric Odessa");
  await page.click("button[type=submit]");
  await expect(page.locator(".bandsearch-results-rail")).toContainText("The earlier atmospheric artist.");
  await page.fill("input[name=query]", "electronic Odessa");
  await page.click("button[type=submit]");
  await expect(page.locator(".bandsearch-results-rail")).toContainText("The later electronic artist.");

  await page.locator(".bandsearch-earlier-picks summary").click();
  const earlier = page.locator(".bandsearch-earlier-picks article");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/preferences") && response.request().method() === "POST");
  await earlier.getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).savedBand).toMatchObject({
    musicbrainzArtistId: firstId,
    note: "The earlier atmospheric artist.",
    noteEdited: false,
    rating: null,
  });
  await expect(earlier.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.locator(".bandsearch-results-rail").getByRole("button", { name: "Save", exact: true })).toBeVisible();

  const rated = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await earlier.getByRole("button", { name: "Rate 4 of 5", exact: true }).click();
  expect((await (await rated).json()).savedBand).toMatchObject({
    musicbrainzArtistId: firstId, rating: 4, note: "The earlier atmospheric artist.", noteEdited: false,
  });
  await earlier.getByRole("button", { name: "Edit category and note" }).click();
  const sheet = earlier.locator(".category-note-sheet");
  await sheet.locator("textarea").fill("I listened to the earlier artist.");
  const annotated = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await annotated).json()).savedBand).toMatchObject({
    musicbrainzArtistId: firstId, rating: 4, note: "I listened to the earlier artist.", noteEdited: true,
  });
});

test("category-only edits preserve a suggested note until the user edits it", async ({ page }) => {
  const mbid = randomUUID();
  let turn = 0;
  await page.route("**/recommendations", (route) => route.fulfill({
    json: {
      recommendations: [{
        artist: "Fen", musicbrainzArtistId: mbid,
        why: turn++ === 0 ? "Atmospheric guitar textures." : "Another recommendation of the same artist.",
      }],
      assistantReply: "Try this artist.",
      meta: {},
    },
  }));
  await page.goto("/");
  await page.fill("input[name=query]", "atmospheric guitar music");
  await page.click("button[type=submit]");
  const card = page.locator(".bandsearch-results-rail article");
  await card.getByRole("button", { name: "Edit category and note" }).click();
  const sheet = card.locator(".category-note-sheet");
  await expect(sheet.locator("textarea")).toHaveValue("Atmospheric guitar textures.");
  await sheet.getByLabel("Category (comma-separated)").fill("blackgaze");
  const categorySaved = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await categorySaved).json()).savedBand).toMatchObject({
    musicbrainzArtistId: mbid,
    categories: ["blackgaze"],
    note: "Atmospheric guitar textures.",
    noteEdited: false,
  });

  await card.getByRole("button", { name: "Edit category and note" }).click();
  await sheet.locator("textarea").fill("");
  const noteSaved = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await noteSaved).json()).savedBand).toMatchObject({
    categories: ["blackgaze"], note: "", noteEdited: true,
  });

  const rated = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await card.getByRole("button", { name: "Rate 4 of 5", exact: true }).click();
  expect((await (await rated).json()).savedBand).toMatchObject({
    rating: 4, categories: ["blackgaze"], note: "", noteEdited: true,
  });
  await page.fill("input[name=query]", "more like Fen");
  await page.click("button[type=submit]");
  await expect(card).toContainText("Another recommendation of the same artist.");
  await page.locator(".bandsearch-earlier-picks summary").click();
  const earlier = page.locator(".bandsearch-earlier-picks article");
  await expect(earlier.getByRole("button", { name: "Clear rating, currently 4 of 5" })).toBeVisible();
  await card.getByRole("button", { name: "Edit category and note" }).click();
  await expect(sheet.locator("textarea")).toHaveValue("");
  await expect(sheet.getByLabel("Category (comma-separated)")).toHaveValue("blackgaze");
  await sheet.getByRole("button", { name: "Cancel", exact: true }).click();

  const cleared = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await card.getByRole("button", { name: "Clear rating, currently 4 of 5" }).click();
  expect((await (await cleared).json()).savedBand.rating).toBeNull();
  await expect(earlier.getByRole("button", { name: "Rate 4 of 5", exact: true })).toBeVisible();
  const removed = page.waitForResponse((response) => response.request().method() === "DELETE");
  await card.getByRole("button", { name: "Saved", exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(card.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(earlier.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});

test("a different same-named artist does not inherit an open annotation draft", async ({ page }) => {
  const ids = [randomUUID(), randomUUID()];
  let turn = 0;
  await page.route("**/recommendations", (route) => {
    const current = turn++;
    return route.fulfill({ json: {
      recommendations: [{ artist: "Odessa", musicbrainzArtistId: ids[current], why: `Artist ${current + 1} rationale.` }],
      assistantReply: "Here is another artist.", meta: {},
    } });
  });
  await page.goto("/");
  await page.fill("input[name=query]", "first Odessa");
  await page.click("button[type=submit]");
  const rail = page.locator(".bandsearch-results-rail");
  await rail.getByRole("button", { name: "Edit category and note" }).click();
  await rail.locator("textarea").fill("A draft about the first artist.");

  await page.fill("input[name=query]", "second Odessa");
  await page.click("button[type=submit]");
  await expect(rail).toContainText("Artist 2 rationale.");
  await expect(rail.locator(".category-note-sheet")).toHaveCount(0);
  await rail.getByRole("button", { name: "Edit category and note" }).click();
  await expect(rail.locator("textarea")).toHaveValue("Artist 2 rationale.");
});

test("editing only a note before the collection loads preserves stored categories and rating", async ({ page }) => {
  const mbid = randomUUID();
  await page.goto("/");
  const token = await page.evaluate((key) => localStorage.getItem(key), AUTH_TOKEN_STORAGE_KEY);
  const seeded = await page.request.post(`${E2E_API_BASE_URL}/preferences`, {
    headers: { authorization: `Bearer ${token}` },
    data: { musicbrainzArtistId: mbid, name: "Codeine", rating: 5, categories: ["favourite"], note: "Original note." },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.route("**/recommendations", (route) => route.fulfill({ json: {
    recommendations: [{ artist: "Codeine", musicbrainzArtistId: mbid, why: "New rationale." }],
    assistantReply: "Try this artist.", meta: {},
  } }));
  await page.goto("/");
  await page.fill("input[name=query]", "slowcore");
  await page.click("button[type=submit]");
  const card = page.locator(".bandsearch-results-rail article");
  await card.getByRole("button", { name: "Edit category and note" }).click();
  const sheet = card.locator(".category-note-sheet");
  await sheet.locator("textarea").fill("My new listening note.");
  const updated = page.waitForResponse((response) =>
    response.url().includes("/preferences/") && response.request().method() === "PATCH");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  expect((await (await updated).json()).savedBand).toMatchObject({
    musicbrainzArtistId: mbid, rating: 5, categories: ["favourite"],
    note: "My new listening note.", noteEdited: true,
  });
});
