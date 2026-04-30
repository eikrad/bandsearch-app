const { test, expect } = require("@playwright/test");

test.describe("Bandsearch UI", () => {
  test("renders the app with mode toggle and input", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toContainText("Bandsearch");
    await expect(page.locator("input[name=query]")).toBeVisible();
    await expect(page.locator("button[type=submit]")).toContainText("Recommend");
    await expect(page.locator(".mode-pill")).toBeVisible();
    await expect(page.locator(".mode-pill button").first()).toBeVisible();
  });

  test("shows empty state on first load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toContainText("Start with 1");
  });

  test("submits a query and renders recommendation cards", async ({ page }) => {
    await page.goto("/");
    await page.fill("input[name=query]", "bands like Alcest");
    await page.click("button[type=submit]");

    const card = page.locator("article").first();
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card.locator("h2")).not.toBeEmpty();
  });

  test("recommendations come from Gemini, not deterministic fallback", async ({ page }) => {
    const apiResponses = [];

    await page.route("**/recommendations", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      apiResponses.push(body);
      await route.fulfill({ response });
    });

    await page.goto("/");
    await page.fill("input[name=query]", "bands like Alcest");
    await page.click("button[type=submit]");

    await page.locator("article").first().waitFor({ timeout: 20000 });

    expect(apiResponses.length).toBeGreaterThan(0);
    const signals = apiResponses[0].recommendations.flatMap((r) => r.sourceSignals);
    const hasFallback = signals.some((s) => s === "deterministic_fallback");
    expect(hasFallback).toBe(false);

    const hasMusicBrainzOnly = apiResponses[0].recommendations.every(
      (r) => r.why.includes("Related match from MusicBrainz"),
    );
    expect(hasMusicBrainzOnly).toBe(false);
  });

  test("mode toggle switches between Fresh and Preference-aware", async ({ page }) => {
    await page.goto("/");

    const warmButton = page.locator(".mode-pill button", { hasText: /preference/i });
    await warmButton.click();
    await expect(warmButton).toHaveClass(/active-warm/);

    await expect(page.locator("main")).toContainText("No saved preferences");

    const freshButton = page.locator(".mode-pill button", { hasText: /fresh/i });
    await freshButton.click();
    await expect(freshButton).toHaveClass(/active-fresh/);
  });
});
