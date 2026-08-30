import test from "node:test";
import assert from "node:assert/strict";

import type { EvalRepository } from "../../src/eval/evalRepository.js";
import type { AggregatedMetrics } from "../../src/eval/evalAggregator.js";

/**
 * One behaviour suite, run against every eval-store adapter.
 *
 * `createSqliteEvalRepository` is what `app.ts` selects whenever the eval
 * dashboard is enabled, but every eval test built an in-memory repository
 * instead, so the SQLite adapter had no coverage at all. Holding both to the
 * same assertions is the cheapest way to keep them honest — the whole point of
 * the in-memory adapter is that it stands in for the real one.
 */
export type EvalRepositoryFactory = () => EvalRepository | Promise<EvalRepository>;

export const sampleDiagnostics = {
  braveHitCount: 10,
  extractedCandidateCount: 6,
  verifiedCount: 4,
  reflectionTriggered: false,
  searchBudgetUsed: 4,
};

export const sampleEvent = {
  query: "dark ambient like Lustmord",
  mode: "fresh",
  obscurityTarget: "obscure",
  pipelineVersion: "0.4.0-alpha.0",
  pipelineDiagnostics: sampleDiagnostics,
  recommendationCount: 5,
};

const sampleMetrics = { antiBandRate: 0.1, nuggetCoverage: 0.8 } as unknown as AggregatedMetrics;

/** `created_at` has millisecond resolution, so ordering needs a real gap. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

export function runEvalRepositoryContract(adapterName: string, createRepository: EvalRepositoryFactory) {
  const label = (name: string) => `[${adapterName}] ${name}`;

  // ---------------------------------------------------------------- events

  test(label("logEvent returns a non-empty id"), async () => {
    const repo = await createRepository();
    const id = await repo.logEvent(sampleEvent);

    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  });

  test(label("logEvent honours a caller-supplied id"), async () => {
    const repo = await createRepository();
    const id = await repo.logEvent({ ...sampleEvent, id: "event-fixed" });

    assert.equal(id, "event-fixed");
    assert.equal((await repo.listEvents())[0].id, "event-fixed");
  });

  test(label("logEvent round-trips the full event shape"), async () => {
    const repo = await createRepository();
    await repo.logEvent({ ...sampleEvent, sessionId: "session-1" });

    const [event] = await repo.listEvents();
    assert.equal(event.query, sampleEvent.query);
    assert.equal(event.mode, sampleEvent.mode);
    assert.equal(event.sessionId, "session-1");
    assert.equal(event.obscurityTarget, "obscure");
    assert.equal(event.pipelineVersion, sampleEvent.pipelineVersion);
    assert.equal(event.recommendationCount, 5);
    assert.deepEqual(event.pipelineDiagnostics, sampleDiagnostics);
    assert.ok(event.createdAt.length > 0);
  });

  test(label("logEvent preserves reflectionTriggered when true"), async () => {
    const repo = await createRepository();
    await repo.logEvent({
      ...sampleEvent,
      pipelineDiagnostics: { ...sampleDiagnostics, reflectionTriggered: true },
    });

    // SQLite has no boolean type, so this round-trips through 0/1.
    assert.equal((await repo.listEvents())[0].pipelineDiagnostics.reflectionTriggered, true);
  });

  test(label("logEvent accepts a null sessionId and obscurityTarget"), async () => {
    const repo = await createRepository();
    await repo.logEvent({ ...sampleEvent, sessionId: null, obscurityTarget: null });

    const [event] = await repo.listEvents();
    assert.equal(event.sessionId, null);
    assert.equal(event.obscurityTarget, null);
  });

  test(label("listEvents returns an empty array before anything is logged"), async () => {
    const repo = await createRepository();
    assert.deepEqual(await repo.listEvents(), []);
  });

  test(label("listEvents returns most recent first"), async () => {
    const repo = await createRepository();
    await repo.logEvent({ ...sampleEvent, query: "first" });
    await tick();
    await repo.logEvent({ ...sampleEvent, query: "second" });

    assert.equal((await repo.listEvents())[0].query, "second");
  });

  test(label("listEvents respects the limit"), async () => {
    const repo = await createRepository();
    for (let i = 0; i < 5; i++) {
      await repo.logEvent({ ...sampleEvent, query: `query ${i}` });
    }

    assert.equal((await repo.listEvents(3)).length, 3);
  });

  // ----------------------------------------------------------- band scores

  test(label("upsertBandEvalScore stores one row per band"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 30000, obscurityTier: "cult" });
    await repo.upsertBandEvalScore({ eventId, bandName: "Raison d'être", listeners: 1500, obscurityTier: "obscure" });

    const scores = await repo.listBandEvalScores(eventId);
    assert.equal(scores.length, 2);
    const lustmord = scores.find((s) => s.bandName === "Lustmord");
    assert.equal(lustmord?.listeners, 30000);
    assert.equal(lustmord?.obscurityTier, "cult");
  });

  test(label("upsertBandEvalScore merges fields for the same (event, band)"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    // This is how the pipeline writes: the automatic layer scores first, then
    // the judge worker upserts its own fields for the same band later. A second
    // upsert must not blank out what the first one wrote.
    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 30000, obscurityTier: "cult" });
    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", sourceQuality: "high" });

    const scores = await repo.listBandEvalScores(eventId);
    assert.equal(scores.length, 1);
    assert.equal(scores[0].listeners, 30000);
    assert.equal(scores[0].obscurityTier, "cult");
    assert.equal(scores[0].sourceQuality, "high");
  });

  test(label("upsertBandEvalScore keeps automatic scores when the judge writes later"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    await repo.upsertBandEvalScore({
      eventId,
      bandName: "Lustmord",
      listeners: 30000,
      obscurityTier: "cult",
      citationSupportRate: 0.75,
      genericWhyFlag: false,
    });
    await repo.upsertBandEvalScore({
      eventId,
      bandName: "Lustmord",
      relevance: 4,
      obscurityFit: 5,
      evidenceQuality: 3,
      discoveryValue: 4,
      judgeReasoning: "strong match",
      modelId: "mistral-small",
    });

    const [score] = await repo.listBandEvalScores(eventId);
    assert.equal(score.relevance, 4);
    assert.equal(score.judgeReasoning, "strong match");
    assert.equal(score.listeners, 30000, "judge upsert must not blank the Last.fm listener count");
    assert.equal(score.obscurityTier, "cult", "judge upsert must not blank the obscurity tier");
    assert.equal(score.citationSupportRate, 0.75, "judge upsert must not blank the citation rate");
    assert.equal(score.genericWhyFlag, false, "judge upsert must not blank the generic-why flag");
  });

  test(label("upsertBandEvalScore overwrites a field it explicitly sets again"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 30000 });
    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 42000 });

    assert.equal((await repo.listBandEvalScores(eventId))[0].listeners, 42000);
  });

  test(label("upsertBandEvalScore round-trips genericWhyFlag true"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", genericWhyFlag: true });

    assert.equal((await repo.listBandEvalScores(eventId))[0].genericWhyFlag, true);
  });

  test(label("listBandEvalScores returns empty for an unknown event"), async () => {
    const repo = await createRepository();
    assert.deepEqual(await repo.listBandEvalScores("does-not-exist"), []);
  });

  test(label("listBandEvalScores scopes to the given event"), async () => {
    const repo = await createRepository();
    const first = await repo.logEvent({ ...sampleEvent, query: "first" });
    const second = await repo.logEvent({ ...sampleEvent, query: "second" });

    await repo.upsertBandEvalScore({ eventId: first, bandName: "Lustmord" });
    await repo.upsertBandEvalScore({ eventId: second, bandName: "Coil" });

    assert.deepEqual((await repo.listBandEvalScores(first)).map((s) => s.bandName), ["Lustmord"]);
  });

  test(label("listBandEvalScoresByEventIds collects scores across events"), async () => {
    const repo = await createRepository();
    const first = await repo.logEvent({ ...sampleEvent, query: "first" });
    const second = await repo.logEvent({ ...sampleEvent, query: "second" });

    await repo.upsertBandEvalScore({ eventId: first, bandName: "Lustmord" });
    await repo.upsertBandEvalScore({ eventId: second, bandName: "Coil" });

    const scores = await repo.listBandEvalScoresByEventIds([first, second]);
    assert.deepEqual(scores.map((s) => s.bandName).sort(), ["Coil", "Lustmord"]);
  });

  test(label("listBandEvalScoresByEventIds ignores unknown ids"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);
    await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord" });

    const scores = await repo.listBandEvalScoresByEventIds([eventId, "does-not-exist"]);
    assert.deepEqual(scores.map((s) => s.bandName), ["Lustmord"]);
  });

  test(label("listBandEvalScoresByEventIds returns empty for an empty id list"), async () => {
    const repo = await createRepository();
    assert.deepEqual(await repo.listBandEvalScoresByEventIds([]), []);
  });

  // ------------------------------------------------------------- baselines

  test(label("createBaseline stores the label and serialised metrics"), async () => {
    const repo = await createRepository();
    const baseline = await repo.createBaseline("v0.4.0", sampleMetrics);

    assert.equal(baseline.label, "v0.4.0");
    assert.deepEqual(JSON.parse(baseline.metricsJson), sampleMetrics);
    assert.ok(baseline.id.length > 0);
    assert.ok(baseline.createdAt.length > 0);
  });

  test(label("listBaselines returns newest first"), async () => {
    const repo = await createRepository();
    await repo.createBaseline("older", sampleMetrics);
    await tick();
    await repo.createBaseline("newer", sampleMetrics);

    assert.deepEqual((await repo.listBaselines()).map((b) => b.label), ["newer", "older"]);
  });

  test(label("listBaselines is empty before any baseline exists"), async () => {
    const repo = await createRepository();
    assert.deepEqual(await repo.listBaselines(), []);
  });

  test(label("getLatestBaseline returns null before any baseline exists"), async () => {
    const repo = await createRepository();
    assert.equal(await repo.getLatestBaseline(), null);
  });

  test(label("getLatestBaseline returns the newest baseline"), async () => {
    const repo = await createRepository();
    await repo.createBaseline("older", sampleMetrics);
    await tick();
    await repo.createBaseline("newer", sampleMetrics);

    assert.equal((await repo.getLatestBaseline())?.label, "newer");
  });

  // -------------------------------------------------------------- feedback

  test(label("logFeedback accepts a feedback row"), async () => {
    const repo = await createRepository();
    const eventId = await repo.logEvent(sampleEvent);

    // Nothing reads feedback back through this interface yet; the contract is
    // that recording it succeeds and never throws on the response path.
    await repo.logFeedback({ eventId, feedbackType: "good" });
    await repo.logFeedback({ eventId, feedbackType: "too_mainstream", userId: "user-b" });
  });
}
