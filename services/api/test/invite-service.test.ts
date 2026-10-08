import { test } from "node:test";
import assert from "node:assert/strict";

import { createInMemoryInviteRepository } from "../src/auth/inviteRepository.js";
import { createInviteService, hashInviteCode } from "../src/auth/inviteService.js";

const T0 = new Date("2026-10-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function service(now: () => Date = () => T0) {
  const inviteRepository = createInMemoryInviteRepository();
  return { inviteRepository, invites: createInviteService({ inviteRepository, now }) };
}

test("an issued invite code carries 128 bits and is never stored in the clear", async () => {
  const { invites, inviteRepository } = service();
  const { code } = await invites.issue({ email: "a@x.com" });

  assert.equal(code.replace(/-/g, "").length, 32, "32 hex digits = 128 bits");
  assert.match(code, /^[0-9a-f-]+$/);
  const [stored] = await inviteRepository.list();
  assert.notEqual(stored.codeHash, code);
  assert.ok(!JSON.stringify(stored).includes(code.replace(/-/g, "")));
});

test("two invites never share a code", async () => {
  const { invites } = service();
  const a = await invites.issue({ email: "a@x.com" });
  const b = await invites.issue({ email: "a@x.com" });
  assert.notEqual(a.code, b.code);
});

test("an invite expires after 14 days unless told otherwise", async () => {
  const { invites } = service();
  const { invite } = await invites.issue({ email: "a@x.com" });
  assert.equal(invite.expiresAt, new Date(T0.getTime() + 14 * DAY).toISOString());

  const custom = await invites.issue({ email: "b@x.com", days: 3 });
  assert.equal(custom.invite.expiresAt, new Date(T0.getTime() + 3 * DAY).toISOString());
});

test("a code redeems for the invited address however it was typed", async () => {
  const { invites } = service();
  const { code } = await invites.issue({ email: "Ann@Example.com" });

  assert.ok(await invites.findRedeemable({ code, email: "ann@example.com" }));
  assert.ok(await invites.findRedeemable({ code: code.toUpperCase(), email: " ANN@example.com " }));
  assert.ok(await invites.findRedeemable({ code: code.replace(/-/g, " "), email: "ann@example.com" }));
});

test("a code does not redeem for any other address", async () => {
  const { invites } = service();
  const { code } = await invites.issue({ email: "ann@example.com" });
  assert.equal(await invites.findRedeemable({ code, email: "mallory@example.com" }), null);
});

test("unknown, blank, expired, used and revoked codes are all simply not redeemable", async () => {
  let now = T0;
  const { invites } = service(() => now);

  assert.equal(await invites.findRedeemable({ code: "0000", email: "a@x.com" }), null);
  assert.equal(await invites.findRedeemable({ code: "", email: "a@x.com" }), null);

  const expiring = await invites.issue({ email: "a@x.com", days: 1 });
  now = new Date(T0.getTime() + 2 * DAY);
  assert.equal(await invites.findRedeemable({ code: expiring.code, email: "a@x.com" }), null);

  now = T0;
  const used = await invites.issue({ email: "b@x.com" });
  const found = await invites.findRedeemable({ code: used.code, email: "b@x.com" });
  assert.ok(found);
  assert.equal(await invites.redeem(found.id), true);
  assert.equal(await invites.findRedeemable({ code: used.code, email: "b@x.com" }), null);

  const revoked = await invites.issue({ email: "c@x.com" });
  assert.equal(await invites.revoke("c@x.com"), 1);
  assert.equal(await invites.findRedeemable({ code: revoked.code, email: "c@x.com" }), null);
});

test("hashing ignores case, dashes and whitespace so one code has one identity", () => {
  assert.equal(hashInviteCode("AB12-cd34"), hashInviteCode(" ab12 CD34 "));
  assert.notEqual(hashInviteCode("ab12cd34"), hashInviteCode("ab12cd35"));
});
