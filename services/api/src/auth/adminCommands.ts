import type { InviteService } from "./inviteService.js";
import { DEFAULT_INVITE_DAYS } from "./inviteService.js";
import type { UserRepository } from "./userRepository.js";
import { normalizeEmail } from "./userModel.js";

/** Operator-facing failure: the message is printed as is, without a stack trace. */
export class AdminCommandError extends Error {}

const COMMANDS = ["invite:create", "invite:list", "invite:revoke", "user:disable", "user:enable"] as const;

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) flags[arg.slice(2)] = args[i + 1] ?? "";
  }
  return flags;
}

function requireEmail(flags: Record<string, string>): string {
  const email = normalizeEmail(flags.email ?? "");
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new AdminCommandError("--email <address> is required");
  return email;
}

function inviteState(invite: { usedAt: string | null; revokedAt: string | null; expiresAt: string }, now: Date) {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (Date.parse(invite.expiresAt) <= now.getTime()) return "expired";
  return "pending";
}

/**
 * The closed-beta operator's toolbox. Admin = whoever holds the database
 * credentials; there is deliberately no HTTP surface for any of this.
 * Returns the lines to print.
 */
export async function runAdminCommand(
  command: string,
  args: string[],
  deps: { invites: InviteService; userRepository: UserRepository; now?: () => Date },
): Promise<string[]> {
  const { invites, userRepository, now = () => new Date() } = deps;
  const flags = parseFlags(args);

  switch (command) {
    case "invite:create": {
      const email = requireEmail(flags);
      const days = flags.days === undefined ? DEFAULT_INVITE_DAYS : Number(flags.days);
      if (!Number.isFinite(days) || days <= 0) throw new AdminCommandError("--days must be a positive number");
      const { code, invite } = await invites.issue({ email, days });
      return [
        `Invite for ${invite.email}, valid until ${invite.expiresAt}`,
        "",
        "Invite code (shown only now, it cannot be recovered):",
        `  ${code}`,
        "",
        `It only works for ${invite.email} and can be used once.`,
      ];
    }

    case "invite:list": {
      const all = await invites.list();
      if (all.length === 0) return ["No invites."];
      const width = Math.max(...all.map((i) => i.email.length));
      return all.map(
        (i) => `${i.email.padEnd(width)}  ${inviteState(i, now()).padEnd(8)}  created ${i.createdAt}  expires ${i.expiresAt}`,
      );
    }

    case "invite:revoke": {
      const email = requireEmail(flags);
      const revoked = await invites.revoke(email);
      return [revoked === 0 ? `No pending invite for ${email}.` : `Revoked ${revoked} invite(s) for ${email}.`];
    }

    case "user:disable":
    case "user:enable": {
      const email = requireEmail(flags);
      const user = await userRepository.findByEmail(email);
      if (!user) throw new AdminCommandError(`No user with address ${email}.`);
      const disable = command === "user:disable";
      await userRepository.setDisabled(user.id, disable);
      return [
        disable
          ? `Disabled ${email}. Their sessions stop working on the next request.`
          : `Enabled ${email}.`,
      ];
    }

    default:
      throw new AdminCommandError(`Unknown command "${command}". Available: ${COMMANDS.join(", ")}`);
  }
}
