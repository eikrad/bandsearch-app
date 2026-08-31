import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

/** Captures what the app posts to /preferences. */
function appWithCapturedSaves() {
  const posted: Array<Record<string, unknown>> = [];
  const app = bootstrapDesktopApp({
    apiBaseUrl: "http://api.test",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (String(url).endsWith("/preferences") && init?.method === "POST") {
        posted.push(body);
        return jsonResponse({ savedBand: { id: "b1", name: body.name, rating: body.rating ?? null, categories: [], note: "" } });
      }
      return jsonResponse({ savedBand: { id: "b1", name: "x", rating: null, categories: [], note: "" } });
    }) as unknown as typeof fetch,
  });
  return { app, posted };
}

test("saving a band without a rating sends no rating", async () => {
  // The defect in #164: Save wrote `rating: options.rating || 3`, so every
  // "just remember this" silently became a middling three-star judgement the
  // user never made and never saw.
  const { app, posted } = appWithCapturedSaves();

  await app.saveBand("Codeine");

  assert.equal(posted.length, 1);
  assert.equal(posted[0].rating ?? null, null, "Save must not invent a rating");
});

test("saving a band with an explicit rating sends that rating", async () => {
  const { app, posted } = appWithCapturedSaves();

  await app.saveBand("Codeine", { rating: 4 });

  assert.equal(posted[0].rating, 4);
});

test("a rating of 1 is not mistaken for no rating", async () => {
  // A guard, not a fix: `|| 3` only swallowed 0, which is not a valid rating
  // anyway. Kept so a future `?? `/`||` mix-up at the low end gets caught.
  const { app, posted } = appWithCapturedSaves();

  await app.saveBand("Codeine", { rating: 1 });

  assert.equal(posted[0].rating, 1, "the lowest rating must survive");
});

test("an unrated style reference does not claim a rating in the prompt", async () => {
  // buildPriorityContext is the second place a saved band is formatted for the
  // model. savedBandContext.ts on the API side was fixed for #164; this copy was
  // missed and interpolated `rating null/5` straight into the prompt.
  const sent: Array<Record<string, unknown>> = [];
  const app = bootstrapDesktopApp({
    apiBaseUrl: "http://api.test",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (String(url).endsWith("/recommendations")) {
        sent.push(body);
        return jsonResponse({ items: [], assistantReply: "" });
      }
      if (String(url).endsWith("/preferences") && init?.method === "POST") {
        return jsonResponse({ savedBand: { id: "b1", name: body.name, rating: null, categories: [], note: "" } });
      }
      return jsonResponse({ savedBands: [] });
    }) as unknown as typeof fetch,
  });

  await app.saveBand("Codeine");
  app.toggleArtistSelection("b1");
  await app.requestRecommendations("something like that");

  const priorityContext = String(sent[0]?.priorityContext ?? "");
  assert.doesNotMatch(priorityContext, /rating (null|undefined|0)/, priorityContext);
  assert.match(priorityContext, /Codeine/);
});
