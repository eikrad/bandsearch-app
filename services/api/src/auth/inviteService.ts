import { createHash, randomBytes } from "node:crypto";
import type { Invite, InviteRepository } from "./inviteRepository.js";
import { normalizeEmail } from "./userModel.js";

export const DEFAULT_INVITE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Case, dashes and whitespace are presentation: strip them so one code has one identity. */
export function normalizeInviteCode(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-z]/g, "");
}

/**
 * SHA-256 is enough here, unlike for passwords: the code is 128 bits of
 * randomness, so there is nothing to brute-force and no need for a slow hash.
 */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}

/** 128 random bits as eight groups of four hex digits, easy to read out or paste. */
function generateInviteCode(): string {
  return (randomBytes(16).toString("hex").match(/.{4}/g) as string[]).join("-");
}

export type InviteService = {
  /** Creates an invite and returns the code. The code is shown once — only its hash is kept. */
  issue(input: { email: string; days?: number }): Promise<{ code: string; invite: Invite }>;
  /**
   * The invite this code grants for this address, or null. Null covers every
   * reason alike (unknown, other address, expired, used, revoked) so callers
   * cannot tell them apart and neither can an attacker.
   */
  findRedeemable(input: { code: string; email: string }): Promise<Invite | null>;
  /** Marks the invite used. True only for the single caller that wins the race. */
  redeem(inviteId: string): Promise<boolean>;
  /** Withdraws the address's pending invites; resolves how many. */
  revoke(email: string): Promise<number>;
  list(): Promise<Invite[]>;
};

export function createInviteService({
  inviteRepository,
  now = () => new Date(),
}: {
  inviteRepository: InviteRepository;
  now?: () => Date;
}): InviteService {
  return {
    async issue({ email, days = DEFAULT_INVITE_DAYS }) {
      const code = generateInviteCode();
      const expiresAt = new Date(now().getTime() + days * DAY_MS).toISOString();
      const invite = await inviteRepository.create({ email, codeHash: hashInviteCode(code), expiresAt });
      return { code, invite };
    },

    async findRedeemable({ code, email }) {
      if (!normalizeInviteCode(code)) return null;
      const invite = await inviteRepository.findByCodeHash(hashInviteCode(code));
      if (!invite) return null;
      if (invite.email !== normalizeEmail(email)) return null;
      if (invite.usedAt || invite.revokedAt) return null;
      if (Date.parse(invite.expiresAt) <= now().getTime()) return null;
      return invite;
    },

    redeem: (inviteId) => inviteRepository.markUsed(inviteId),
    revoke: (email) => inviteRepository.revokeByEmail(email),
    list: () => inviteRepository.list(),
  };
}
