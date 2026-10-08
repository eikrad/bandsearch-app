import test from "node:test";
import assert from "node:assert/strict";

import type { InviteRepository } from "../../src/auth/inviteRepository.js";

export type InviteRepositoryFactory = () => InviteRepository | Promise<InviteRepository>;

const FUTURE = "2999-01-01T00:00:00.000Z";

/** One behaviour suite for the invite store, run against every adapter. */
export function runInviteRepositoryContract(adapter: string, makeRepo: InviteRepositoryFactory): void {
  test(`[${adapter}] an issued invite can be found by the hash of its code`, async () => {
    const repo = await makeRepo();
    const created = await repo.create({ email: "Ann@Example.com", codeHash: "hash-1", expiresAt: FUTURE });

    const found = await repo.findByCodeHash("hash-1");
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.email, "ann@example.com", "the invited address is stored normalized");
    assert.equal(found.expiresAt, FUTURE);
    assert.equal(found.usedAt, null);
    assert.equal(found.revokedAt, null);
    assert.ok(found.createdAt);
  });

  test(`[${adapter}] an unknown code hash finds nothing`, async () => {
    const repo = await makeRepo();
    assert.equal(await repo.findByCodeHash("nope"), null);
  });

  test(`[${adapter}] two invites cannot share a code hash`, async () => {
    const repo = await makeRepo();
    await repo.create({ email: "a@x.com", codeHash: "dup", expiresAt: FUTURE });
    await assert.rejects(repo.create({ email: "b@x.com", codeHash: "dup", expiresAt: FUTURE }));
  });

  test(`[${adapter}] an invite can be redeemed exactly once`, async () => {
    const repo = await makeRepo();
    const invite = await repo.create({ email: "a@x.com", codeHash: "h", expiresAt: FUTURE });

    assert.equal(await repo.markUsed(invite.id), true);
    assert.equal(await repo.markUsed(invite.id), false, "a second redemption loses");
    const found = await repo.findByCodeHash("h");
    assert.ok(found?.usedAt, "the redemption time is recorded");
  });

  test(`[${adapter}] revoking an address withdraws its pending invites but leaves used ones alone`, async () => {
    const repo = await makeRepo();
    const used = await repo.create({ email: "a@x.com", codeHash: "used", expiresAt: FUTURE });
    await repo.markUsed(used.id);
    await repo.create({ email: "a@x.com", codeHash: "pending", expiresAt: FUTURE });
    await repo.create({ email: "other@x.com", codeHash: "other", expiresAt: FUTURE });

    assert.equal(await repo.revokeByEmail(" A@X.com "), 1);

    assert.ok((await repo.findByCodeHash("pending"))?.revokedAt);
    assert.equal((await repo.findByCodeHash("used"))?.revokedAt, null);
    assert.equal((await repo.findByCodeHash("other"))?.revokedAt, null);
  });

  test(`[${adapter}] a revoked invite cannot be redeemed`, async () => {
    const repo = await makeRepo();
    const invite = await repo.create({ email: "a@x.com", codeHash: "h", expiresAt: FUTURE });
    await repo.revokeByEmail("a@x.com");
    assert.equal(await repo.markUsed(invite.id), false);
  });

  test(`[${adapter}] listing returns every invite, newest first`, async () => {
    const repo = await makeRepo();
    await repo.create({ email: "a@x.com", codeHash: "h1", expiresAt: FUTURE });
    await new Promise((r) => setTimeout(r, 5));
    await repo.create({ email: "b@x.com", codeHash: "h2", expiresAt: FUTURE });

    const all = await repo.list();
    assert.deepEqual(all.map((i) => i.email), ["b@x.com", "a@x.com"]);
  });
}
