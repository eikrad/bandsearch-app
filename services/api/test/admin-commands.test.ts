import { test } from "node:test";
import assert from "node:assert/strict";

import { createInMemoryInviteRepository } from "../src/auth/inviteRepository.js";
import { createInviteService } from "../src/auth/inviteService.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { AdminCommandError, runAdminCommand } from "../src/auth/adminCommands.js";

const T0 = new Date("2026-10-01T12:00:00.000Z");

function operator(now: () => Date = () => T0) {
  const inviteRepository = createInMemoryInviteRepository();
  const userRepository = createInMemoryUserRepository();
  const invites = createInviteService({ inviteRepository, now });
  const run = (command: string, ...args: string[]) =>
    runAdminCommand(command, args, { invites, userRepository, now }).then((lines) => lines.join("\n"));
  return { run, invites, userRepository };
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
