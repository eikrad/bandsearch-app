import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import type { UserRepository, PublicUser } from "./userRepository";
import type { UserDataStore } from "../privacy/userDataStore.js";

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRES_IN = "30d";

export type AuthService = {
  register(input: { email: string; displayName: string; password: string }): Promise<
    { ok: true; user: PublicUser; token: string; recoveryCode: string } | { ok: false; error: string }
  >;
  login(input: { email: string; password: string }): Promise<
    { ok: true; user: PublicUser; token: string } | { ok: false; error: string }
  >;
  verifyToken(token: string): { ok: true; userId: string } | { ok: false; error: string };
  resetPassword(input: { email: string; recoveryCode: string; newPassword: string }): Promise<
    { ok: true; newRecoveryCode: string } | { ok: false; error: string }
  >;
  deleteAccount(input: { userId: string; password: string }): Promise<
    { ok: true; erased: Record<string, number> } | { ok: false; error: string; reason?: "unavailable" }
  >;
  getStatus(): Promise<{ userCount: number }>;
};

function generateRecoveryCode(): string {
  const hex = randomBytes(20).toString("hex");
  return (hex.match(/.{1,5}/g) as string[]).join("-");
}

export function createAuthService({
  userRepository,
  jwtSecret,
  userDataStore = null,
}: {
  userRepository: UserRepository;
  jwtSecret: string;
  /**
   * Where a user's rows actually live. Null when no backend can provide one
   * (the in-memory preference store, for instance), in which case deletion
   * reports itself unavailable rather than succeeding without erasing.
   */
  userDataStore?: UserDataStore | null;
}): AuthService {
  async function register({ email, displayName, password }: { email: string; displayName: string; password: string }) {
    if (!email || !email.trim()) return { ok: false as const, error: "email is required" };
    if (!password) return { ok: false as const, error: "password is required" };

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, BCRYPT_ROUNDS);

    let user: PublicUser;
    try {
      user = await userRepository.create({ email, displayName, passwordHash, recoveryCodeHash });
    } catch (err: unknown) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }

    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    return { ok: true as const, user, token, recoveryCode };
  }

  async function login({ email, password }: { email: string; password: string }) {
    const user = await userRepository.findByEmail(email);
    if (!user) return { ok: false as const, error: "invalid credentials" };

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return { ok: false as const, error: "invalid credentials" };

    const { passwordHash: _ph, recoveryCodeHash: _rc, ...publicUser } = user;
    void _ph;
    void _rc;
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
    return { ok: true as const, user: publicUser, token };
  }

  function verifyToken(token: string) {
    try {
      const payload = jwt.verify(token, jwtSecret) as { sub: string };
      return { ok: true as const, userId: payload.sub };
    } catch {
      return { ok: false as const, error: "invalid token" };
    }
  }

  async function resetPassword({
    email,
    recoveryCode,
    newPassword,
  }: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }) {
    const user = await userRepository.findByEmail(email);
    if (!user) return { ok: false as const, error: "invalid recovery code" };

    const match = await bcrypt.compare(recoveryCode, user.recoveryCodeHash);
    if (!match) return { ok: false as const, error: "invalid recovery code" };

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const newRecoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(newRecoveryCode, BCRYPT_ROUNDS);

    await userRepository.updatePassword(user.id, { passwordHash, recoveryCodeHash });
    return { ok: true as const, newRecoveryCode };
  }

  /**
   * GDPR Art. 17 erasure. The password is required as a secondary secret, the
   * same shape as resetPassword requiring the recovery code — the recovery
   * code is for recovering an account, not destroying one.
   */
  async function deleteAccount({ userId, password }: { userId: string; password: string }) {
    if (!password) return { ok: false as const, error: "password is required" };
    if (!userDataStore) {
      return { ok: false as const, error: "account deletion is not available", reason: "unavailable" as const };
    }

    const user = await userRepository.findById(userId);
    if (!user) return { ok: false as const, error: "invalid credentials" };

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return { ok: false as const, error: "invalid credentials" };

    const erased = await userDataStore.eraseUserData(userId);
    return { ok: true as const, erased };
  }

  async function getStatus() {
    const userCount = await userRepository.countUsers();
    return { userCount };
  }

  return { register, login, verifyToken, resetPassword, deleteAccount, getStatus };
}
