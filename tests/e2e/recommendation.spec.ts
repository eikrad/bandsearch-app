import { expect, test } from "@playwright/test";

type RecommendationApiResponse = {
  recommendations: Array<{
    why: string;
    sourceSignals: string[];
  }>;
};

/**
 * Tests tagged `@live` drive the real research pipeline: Gemini plans the search,
 * Brave runs it, MusicBrainz verifies each candidate. They are excluded from
 * `npm run test:e2e` and run by `npm run test:e2e:live`.
 *
 * They are opt-in because their wall time is not ours to control. MusicBrainz
 * allows roughly one request per second, so verifying ~25 candidates dominates
 * the run and degrades sharply once it starts throttling: the same query has
 * measured 26 s on a cold client and over 150 s after a handful of consecutive
 * runs. That is a property of the upstream service, not a regression, and no
 * timeout value makes it deterministic — so it does not belong in the suite
 * people run before committing.
 */
const LIVE_PIPELINE_TIMEOUT_MS = 180_000;

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

  test("submits a query and renders recommendation cards @live", async ({ page }) => {
    await page.goto("/");
    await page.fill("input[name=query]", "bands like Alcest");
    await page.click("button[type=submit]");

    const card = page.locator("article").first();
    await expect(card).toBeVisible({ timeout: LIVE_PIPELINE_TIMEOUT_MS });
    await expect(card.locator("h2")).not.toBeEmpty();
  });

  test("recommendations come from Gemini, not deterministic fallback @live", async ({ page }) => {
    const apiResponses: RecommendationApiResponse[] = [];

    await page.route("**/recommendations", async (route) => {
      const response = await route.fetch();
      const body = await response.json() as RecommendationApiResponse;
      apiResponses.push(body);
      await route.fulfill({ response });
    });

    await page.goto("/");
    await page.fill("input[name=query]", "bands like Alcest");
    await page.click("button[type=submit]");

    await page.locator("article").first().waitFor({ timeout: LIVE_PIPELINE_TIMEOUT_MS });

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
