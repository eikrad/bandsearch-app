import type { User, PublicUser } from "./userRepository.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicUser(user: User): PublicUser {
  const { passwordHash: _ph, recoveryCodeHash: _rc, disabledAt: _da, ...pub } = user;
  void _ph;
  void _rc;
  void _da;
  return pub;
}

export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    passwordHash: row.password_hash as string,
    recoveryCodeHash: row.recovery_code_hash as string,
    createdAt: row.created_at as string,
    disabledAt: (row.disabled_at as string | null | undefined) ?? null,
  };
}
