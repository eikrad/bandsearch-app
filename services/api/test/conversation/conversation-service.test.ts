import test from "node:test";
import assert from "node:assert/strict";

import { conversationKey, createConversationMemory } from "../../src/agent/conversation/conversationMemory.js";
import { createConversationService, type TurnRequest } from "../../src/agent/conversation/conversationService.js";
import {
  braveResults,
  extractedCandidates,
  fakeFetch,
  fakeModelClient,
  graphDeps,
  musicbrainzArtists,
  rankedRecommendations,
} from "../helpers/researchGraphHarness.js";

const BANDS = ["Fen", "Ghost Bath", "Olhava", "Sundrowned", "Adorn", "Heretoir", "Svalbard"];
const why = "Post-black, see https://blog.example/ffo";

/** A chat whose searches find BANDS; its ranker picks the first `perAnswer` of the bands it is given. */
function chat(
  responders: Parameters<typeof fakeModelClient>[0] = {},
  { perAnswer = 3, bands = BANDS }: { perAnswer?: number; bands?: string[] } = {},
) {
  const { client, calls } = fakeModelClient({
    extract: () => extractedCandidates(bands.map((name) => ({ name }))),
    rank: ({ user }) => {
      const offered = [...user.matchAll(/^artist: (.+)$/gm)].map((m) => m[1]!);
      return rankedRecommendations(offered.slice(0, perAnswer).map((artist) => ({ artist, why })));
    },
    ...responders,
  });
  const { fetchImpl, log } = fakeFetch({
    brave: () => braveResults([{ title: "FFO Alcest", url: "https://blog.example/ffo", description: bands.join(", ") }]),
    musicbrainz: () => musicbrainzArtists(bands.map((name) => ({ id: `mbid-${name}`, name }))),
    lastFm: (url) => (url.includes("getinfo") ? { artist: { stats: { listeners: "20000" } } } : {}),
  });
  const events: string[] = [];
  const service = createConversationService({
    memory: createConversationMemory(),
    model: "test-model",
    graphDeps: graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm", onLog: (_l, event) => events.push(event) }),
  });
  const ask = (query: string, overrides: Partial<TurnRequest> = {}) => service.respond({
    query,
    mode: "fresh",
    preferenceContext: "",
    messages: [{ role: "user", content: "bands like Alcest" }, { role: "assistant", content: "Try Fen." }],
    obscurityTarget: "underground",
    conversationKey: "chat-1",
    ...overrides,
  });
  const searches = () => log.filter((c) => c.url.includes("api.search.brave.com")).length;
  const routed = () => calls.filter((c) => c.system.startsWith("You decide how"));
  return { ask, searches, routed, calls, events, client };
}

const artists = (result: { recommendations: unknown[] }) =>
  result.recommendations.map((r) => (r as { artist: string }).artist);

test("the first message of a conversation searches without asking how to answer", async () => {
  const { ask, searches, routed } = chat();
  const first = await ask("bands like Alcest", { messages: [] });
  assert.equal(first.turn, "search");
  assert.deepEqual(artists(first), ["Fen", "Ghost Bath", "Olhava"]);
  assert.equal(searches(), 1);
  assert.equal(routed().length, 0);
});

test("a request for more is picked from the bands already found, without another search", async () => {
  const { ask, searches } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { messages: [] });

  const more = await ask("more please");

  assert.equal(more.turn, "pick");
  assert.deepEqual(artists(more), ["Sundrowned", "Adorn", "Heretoir"], "bands already shown are not offered again");
  assert.equal(searches(), 1);
  assert.equal(more.model, "test-model");
});

test("picking goes on until too few unseen bands are left, then searches", async () => {
  const { ask, searches } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { messages: [] });
  await ask("more");
  const third = await ask("more");
  assert.equal(third.turn, "search", "one unseen band is not an answer");
  assert.equal(searches(), 2);
  assert.deepEqual(artists(third), ["Svalbard"], "a new search does not repeat shown bands either");
});

test("the router sees the picks in order and the unseen bands", async () => {
  const { ask, routed } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { messages: [] });
  await ask("more like the second one");
  const prompt = routed()[0]!.user;
  assert.match(prompt, /\[LATEST_PICKS\]\n1\. Fen.*\n2\. Ghost Bath.*\n3\. Olhava/);
  assert.match(prompt, /\[UNSEEN_CANDIDATES\]\nSundrowned \(20000 listeners\)/);
  assert.match(prompt, /more like the second one/);
});

test("a question about the shown bands is answered in words, from their evidence", async () => {
  const { ask, calls, searches } = chat({ route: () => ({ action: "answer" }), answer: () => "Fen are from England." });
  await ask("bands like Alcest", { messages: [] });

  const reply = await ask("where are Fen from?");

  assert.equal(reply.turn, "answer");
  assert.equal(reply.assistantReply, "Fen are from England.");
  assert.deepEqual(reply.recommendations, []);
  assert.equal(searches(), 1);
  const writer = calls.find((c) => c.system.startsWith("You are the conversational side"))!;
  assert.match(writer.user, /artist: Fen/);
  assert.match(writer.user, /\[LATEST_PICKS\]\n1\. Fen\n2\. Ghost Bath\n3\. Olhava/);
  assert.doesNotMatch(writer.user, /artist: Sundrowned/, "only bands the user has seen");
});

test("after a restart thanks are still answered in words; a request for more searches", async () => {
  const { ask, searches } = chat({ route: ({ user }) => ({ action: user.includes("thanks") ? "answer" : "pick" }) });
  assert.equal((await ask("thanks!")).turn, "answer");
  assert.equal((await ask("more")).turn, "search");
  assert.equal(searches(), 1);
});

test("a changed obscurity target searches again", async () => {
  const { ask, searches } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { messages: [] });
  assert.equal((await ask("more", { obscurityTarget: "cult" })).turn, "search");
  assert.equal(searches(), 2);
});

test("one conversation never sees the bands of another", async () => {
  const { ask } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { messages: [] });
  assert.equal((await ask("more", { conversationKey: "chat-2" })).turn, "search");
});

test("a one-off question always searches and leaves nothing behind", async () => {
  const { ask, searches, routed } = chat({ route: () => ({ action: "pick" }) });
  await ask("bands like Alcest", { conversationKey: null });
  await ask("more", { conversationKey: null });
  assert.equal(searches(), 2);
  assert.equal(routed().length, 0);
});

for (const [what, route] of [
  ["fails", () => { throw new Error("router down"); }],
  ["answers nonsense", () => ({ action: "dance" })],
] as const) {
  test(`when the router ${what} the message is searched`, async () => {
    const { ask } = chat({ route });
    await ask("bands like Alcest", { messages: [] });
    assert.equal((await ask("more")).turn, "search");
  });
}

test("a pick that finds no fitting band, or fails, falls back to a search", async () => {
  for (const second of [() => rankedRecommendations([]), () => ({ nonsense: true })]) {
    let ranked = 0;
    const { ask } = chat({
      route: () => ({ action: "pick" }),
      rank: () => {
        ranked += 1;
        return ranked === 2 ? second() : rankedRecommendations([{ artist: "Fen", why }]);
      },
    });
    await ask("bands like Alcest", { messages: [] });
    assert.equal((await ask("more")).turn, "search");
  }
});

test("a failed answer fails the request instead of searching for a thank-you", async () => {
  const { ask, searches } = chat({ route: () => ({ action: "answer" }), answer: () => "" });
  await assert.rejects(ask("thanks"), /no answer/);
  assert.equal(searches(), 0);
});

test("a deleted account's conversations are forgotten, no one else's", () => {
  const memory = createConversationMemory();
  const conversation = { candidates: [], shown: [], obscurityTarget: undefined, diagnostics: {
    braveHitCount: 0, extractedCandidateCount: 0, verifiedCount: 0, reflectionTriggered: false, searchBudgetUsed: 0,
  } };
  const keys = [conversationKey("user-a", "chat")!, conversationKey("user-b", "chat")!, conversationKey(undefined, "chat")!];
  for (const key of keys) memory.set(key, conversation);
  memory.forgetUser("user-a");
  assert.deepEqual(keys.map((key) => memory.get(key) !== undefined), [false, true, true]);
});

test("a conversation belongs to the authenticated user, whatever id the request names", () => {
  assert.notEqual(conversationKey("user-a", "chat"), conversationKey("user-b", "chat"));
  assert.notEqual(conversationKey(undefined, "chat"), conversationKey("user-a", "chat"));
  assert.notEqual(conversationKey("a", 'b","c'), conversationKey('a","b', "c"));
  assert.equal(conversationKey("user-a", undefined), null);
});
