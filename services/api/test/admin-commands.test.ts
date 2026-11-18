import { test } from "node:test";
import assert from "node:assert/strict";

import { createInMemoryInviteRepository } from "../src/auth/inviteRepository.js";
import { createInviteService } from "../src/auth/inviteService.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { AdminCommandError, runAdminCommand } from "../src/auth/adminCommands.js";
import { createRecommendationFeedback } from "../src/feedback/recommendationFeedback.js";
import { createInMemoryFeedbackRepository } from "../src/feedback/feedbackRepository.js";

const T0 = new Date("2026-10-01T12:00:00.000Z");

function operator(now: () => Date = () => T0) {
  const inviteRepository = createInMemoryInviteRepository();
  const userRepository = createInMemoryUserRepository();
  const invites = createInviteService({ inviteRepository, now });
  const feedbackRepository = createInMemoryFeedbackRepository();
  const feedback = createRecommendationFeedback({ repository: feedbackRepository, now });
  const run = (command: string, ...args: string[]) =>
    runAdminCommand(command, args, { invites, userRepository, feedback, now }).then((lines) => lines.join("\n"));
  return { run, invites, userRepository, feedback };
}

test("creating an invite prints the code once, with the address and expiry", async () => {
  const { run, invites } = operator();
  const output = await run("invite:create", "--email", "Ann@Example.com");

  const [stored] = await invites.list();
  assert.equal(stored.email, "ann@example.com");
  const code = output.match(/[0-9a-f]{4}(-[0-9a-f]{4}){7}/)?.[0];
  assert.ok(code, "the code appears in the output");
  assert.ok(await invites.findRedeemable({ code, email: "ann@example.com" }), "and it is the working code");
  assert.match(output, /ann@example\.com/);
  assert.match(output, /2026-10-15/, "14 days by default");
});

test("an invite can be given a custom lifetime in days", async () => {
  const { run } = operator();
  assert.match(await run("invite:create", "--email", "a@x.com", "--days", "3"), /2026-10-04/);
});

test("creating an invite needs an address and a sensible lifetime", async () => {
  const { run } = operator();
  await assert.rejects(run("invite:create"), AdminCommandError);
  await assert.rejects(run("invite:create", "--email", "not-an-email"), AdminCommandError);
  await assert.rejects(run("invite:create", "--email", "a@x.com", "--days", "0"), AdminCommandError);
  await assert.rejects(run("invite:create", "--email", "a@x.com", "--days", "soon"), AdminCommandError);
});

test("listing shows each invite's state and never a code", async () => {
  let now = T0;
  const { run, invites } = operator(() => now);
  const pending = await invites.issue({ email: "pending@x.com" });
  const used = await invites.issue({ email: "used@x.com" });
  const usedInvite = await invites.findRedeemable({ code: used.code, email: "used@x.com" });
  assert.ok(usedInvite);
  await invites.redeem(usedInvite.id);
  await invites.issue({ email: "revoked@x.com" });
  await invites.revoke("revoked@x.com");
  await invites.issue({ email: "expired@x.com", days: 1 });
  now = new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000);

  const output = await run("invite:list");

  assert.match(output, /used@x\.com\s+used/);
  assert.match(output, /revoked@x\.com\s+revoked/);
  assert.match(output, /expired@x\.com\s+expired/);
  assert.match(output, /pending@x\.com\s+pending/, "a 14-day invite is still pending after 2 days");
  assert.ok(!output.includes(pending.code));
});

test("listing with no invites says so", async () => {
  assert.match(await operator().run("invite:list"), /no invites/i);
});

test("revoking withdraws an address's pending invites", async () => {
  const { run, invites } = operator();
  const { code } = await invites.issue({ email: "a@x.com" });

  assert.match(await run("invite:revoke", "--email", "a@x.com"), /revoked 1/i);
  assert.equal(await invites.findRedeemable({ code, email: "a@x.com" }), null);
  assert.match(await run("invite:revoke", "--email", "a@x.com"), /no pending invite/i);
});

test("disabling and enabling a user switches the account off and on", async () => {
  const { run, userRepository } = operator();
  const user = await userRepository.create({ email: "a@x.com", displayName: "A", passwordHash: "h", recoveryCodeHash: "r" });

  await run("user:disable", "--email", "A@x.com");
  assert.ok((await userRepository.findById(user.id))?.disabledAt);

  await run("user:enable", "--email", "a@x.com");
  assert.equal((await userRepository.findById(user.id))?.disabledAt, null);
});

test("disabling or enabling an unknown user is reported, not ignored", async () => {
  const { run } = operator();
  await assert.rejects(run("user:disable", "--email", "ghost@x.com"), /no user/i);
  await assert.rejects(run("user:enable", "--email", "ghost@x.com"), /no user/i);
  await assert.rejects(run("user:disable"), AdminCommandError);
});

test("an unknown command lists the available ones", async () => {
  await assert.rejects(operator().run("invite:delete-everything"), /invite:create/);
});

// ---------------------------------------------------------------------------
// feedback:list — the operator's view of recommendation feedback (#307)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const batch = { query: "slowcore like Codeine", mode: "fresh", obscurityTarget: "underground", bandNames: ["Bedhead", "Duster"] };

test("listing feedback shows counts per type, then each verdict with its batch and the user's address", async () => {
  let now = new Date(T0.getTime() - 2 * DAY_MS);
  const { run, userRepository, feedback } = operator(() => now);
  const ann = await userRepository.create({ email: "ann@example.com", displayName: "Ann", passwordHash: "h", recoveryCodeHash: "h" });
  await feedback.submit("ev-1", { ...batch, feedbackType: "too_mainstream" }, ann.id);
  await feedback.submit("ev-2", { ...batch, query: "drone", feedbackType: "good", obscurityTarget: null }, null);
  await feedback.submit("ev-3", { ...batch, feedbackType: "good" }, ann.id);
  now = T0;

  const output = await run("feedback:list");

  assert.match(output, /last 7 days/);
  assert.match(output, /3 verdicts/);
  assert.match(output, /good 2/);
  assert.match(output, /too_mainstream 1/);
  assert.match(output, /wrong_direction 0/);
  assert.match(output, /too_mainstream.*ann@example\.com/);
  assert.match(output, /slowcore like Codeine/);
  assert.match(output, /Bedhead, Duster/);
  assert.match(output, /underground/);
  assert.match(output, /no account/, "a verdict from an install without accounts says so");
});

test("listing feedback covers the requested number of days", async () => {
  let now = new Date(T0.getTime() - 20 * DAY_MS);
  const { run, feedback } = operator(() => now);
  await feedback.submit("ev-old", { ...batch, feedbackType: "wrong_direction" }, null);
  now = T0;

  assert.match(await run("feedback:list"), /0 verdicts/);
  assert.match(await run("feedback:list", "--days", "30"), /1 verdict\b/);
  await assert.rejects(run("feedback:list", "--days", "0"), AdminCommandError);
  await assert.rejects(run("feedback:list", "--days", "soon"), AdminCommandError);
});

test("listing feedback as JSON gives the rows with each user's address, for a spreadsheet or script", async () => {
  const { run, userRepository, feedback } = operator();
  const ann = await userRepository.create({ email: "ann@example.com", displayName: "Ann", passwordHash: "h", recoveryCodeHash: "h" });
  await feedback.submit("ev-1", { ...batch, feedbackType: "good" }, ann.id);

  const rows: unknown = JSON.parse(await run("feedback:list", "--json", "--days", "7"));
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userEmail, "ann@example.com");
  assert.equal(rows[0].eventId, "ev-1");
  assert.deepEqual(rows[0].bandNames, ["Bedhead", "Duster"]);
  assert.equal(rows[0].query, "slowcore like Codeine");
});
