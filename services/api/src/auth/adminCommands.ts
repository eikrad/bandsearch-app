import type { InviteService } from "./inviteService.js";
import { DEFAULT_INVITE_DAYS } from "./inviteService.js";
import type { UserRepository } from "./userRepository.js";
import { normalizeEmail } from "./userModel.js";
import type { RecommendationFeedback, RecommendationFeedbackRow } from "../feedback/recommendationFeedback.js";

/** Operator-facing failure: the message is printed as is, without a stack trace. */
export class AdminCommandError extends Error {}

const COMMANDS = ["invite:create", "invite:list", "invite:revoke", "user:disable", "user:enable", "feedback:list"] as const;

const FEEDBACK_TYPES = ["good", "too_mainstream", "wrong_direction"] as const;
const DEFAULT_FEEDBACK_DAYS = 7;

/** `--name value`; a flag followed by another flag, or by nothing, is a switch. */
function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[arg.slice(2)] = "";
    } else {
      flags[arg.slice(2)] = next;
      i++;
    }
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

/** Resolves each owner once; feedback rows only carry the user id. */
async function withUserEmails(rows: RecommendationFeedbackRow[], userRepository: UserRepository) {
  const emails = new Map<string, string | null>();
  for (const userId of new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null))) {
    emails.set(userId, (await userRepository.findById(userId))?.email ?? null);
  }
  return rows.map((row) => ({ ...row, userEmail: row.userId ? emails.get(row.userId) ?? null : null }));
}

function formatFeedback(rows: Awaited<ReturnType<typeof withUserEmails>>, days: number): string[] {
  const counts = FEEDBACK_TYPES.map((type) => `${type} ${rows.filter((row) => row.feedbackType === type).length}`);
  const lines = [
    `Recommendation feedback, last ${days} days: ${rows.length} ${rows.length === 1 ? "verdict" : "verdicts"}`,
    `  ${counts.join("  ")}`,
  ];
  for (const row of rows) {
    const who = row.userEmail ?? (row.userId ? "(unknown account)" : "(no account)");
    const settings = [row.mode, row.obscurityTarget].filter(Boolean).join(", ");
    lines.push(
      "",
      `${row.createdAt.slice(0, 16).replace("T", " ")}  ${row.feedbackType.padEnd(15)}  ${who}`,
      `  "${row.query}" (${settings})`,
      `  ${row.bandNames.length > 0 ? row.bandNames.join(", ") : "(no bands)"}`,
    );
  }
  return lines;
}

/**
 * The closed-beta operator's toolbox. Admin = whoever holds the database
 * credentials; there is deliberately no HTTP surface for any of this.
 * Returns the lines to print.
 */
export async function runAdminCommand(
  command: string,
  args: string[],
  deps: {
    invites: InviteService;
    userRepository: UserRepository;
    feedback: Pick<RecommendationFeedback, "listRecent">;
    now?: () => Date;
  },
): Promise<string[]> {
  const { invites, userRepository, feedback, now = () => new Date() } = deps;
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

    case "feedback:list": {
      const days = flags.days === undefined ? DEFAULT_FEEDBACK_DAYS : Number(flags.days);
      if (!Number.isInteger(days) || days <= 0) throw new AdminCommandError("--days must be a positive whole number");
      const rows = await withUserEmails(await feedback.listRecent(days), userRepository);
      return "json" in flags ? [JSON.stringify(rows, null, 2)] : formatFeedback(rows, days);
    }

    default:
      throw new AdminCommandError(`Unknown command "${command}". Available: ${COMMANDS.join(", ")}`);
  }
}
