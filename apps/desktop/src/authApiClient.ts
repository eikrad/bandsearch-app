export type AuthUser = { id: string; email: string; displayName: string; createdAt: string };

/**
 * What `/auth/status` told us — or that it told us nothing.
 *
 * A union rather than a flag, because "unreachable" and "auth is disabled" are
 * not two values of one property: only a 2xx answer says anything about auth at
 * all. Modelling them separately makes the contradictory state unrepresentable
 * and forces every caller to handle the third case, which is what went wrong
 * before: an unreachable API collapsed into `{ enabled: false }`, and the
 * startup gate read that as "no auth needed" and waved the user through.
 */
export type AuthStatus =
  | { reachable: true; enabled: boolean; userCount: number }
  | { reachable: false; reason: AuthStatusUnreachableReason };

/** `http_<status>` for an answer we cannot use, `network_error` for no answer. */
export type AuthStatusUnreachableReason = `http_${number}` | "network_error";

export type RegisterResult =
  | { ok: true; user: AuthUser; token: string; recoveryCode: string }
  | { ok: false; error: string };

export type LoginResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; error: string };

export type ResetPasswordResult =
  | { ok: true; newRecoveryCode: string }
  | { ok: false; error: string };

export type DeleteAccountResult =
  | { ok: true; erased: Record<string, number> }
  | { ok: false; error: string };

export type AuthApiClient = {
  getAuthStatus(): Promise<AuthStatus>;
  register(input: { email: string; displayName: string; password: string }): Promise<RegisterResult>;
  login(input: { email: string; password: string }): Promise<LoginResult>;
  resetPassword(input: { email: string; recoveryCode: string; newPassword: string }): Promise<ResetPasswordResult>;
  deleteAccount(input: { password: string }): Promise<DeleteAccountResult>;
};

type ApiErrorBody = { message?: string };

export function createAuthApiClient({
  apiBaseUrl,
  fetchImpl = fetch,
  getToken = null,
}: {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  /** Supplies the bearer token for the routes that identify the caller. */
  getToken?: (() => string | null) | null;
}): AuthApiClient {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  async function post(path: string, body: Record<string, string>) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = typeof getToken === "function" ? getToken() : null;
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, data };
  }

  function extractError(data: Record<string, unknown>, fallback: string): string {
    const err = data.error as ApiErrorBody | undefined;
    return err?.message ?? fallback;
  }

  return {
    async getAuthStatus(): Promise<AuthStatus> {
      try {
        const res = await fetchImpl(`${base}/auth/status`, { method: "GET" });
        // Render serves 502/503 while a spun-down instance wakes, so a non-2xx
        // is "ask again", never an answer about auth.
        if (!res.ok) return { reachable: false, reason: `http_${res.status}` };
        const data = (await res.json()) as { enabled?: unknown; userCount?: unknown };
        return {
          reachable: true,
          enabled: Boolean(data.enabled),
          userCount: Number(data.userCount) || 0,
        };
      } catch {
        return { reachable: false, reason: "network_error" };
      }
    },

    async register({ email, displayName, password }): Promise<RegisterResult> {
      const { ok, data } = await post("/auth/register", { email, displayName, password });
      if (!ok) return { ok: false, error: extractError(data, "registration failed") };
      return { ok: true, user: data.user as AuthUser, token: data.token as string, recoveryCode: data.recoveryCode as string };
    },

    async login({ email, password }): Promise<LoginResult> {
      const { ok, data } = await post("/auth/login", { email, password });
      if (!ok) return { ok: false, error: extractError(data, "login failed") };
      return { ok: true, user: data.user as AuthUser, token: data.token as string };
    },

    async resetPassword({ email, recoveryCode, newPassword }): Promise<ResetPasswordResult> {
      const { ok, data } = await post("/auth/reset-password", { email, recoveryCode, newPassword });
      if (!ok) return { ok: false, error: extractError(data, "reset failed") };
      return { ok: true, newRecoveryCode: data.newRecoveryCode as string };
    },

    async deleteAccount({ password }): Promise<DeleteAccountResult> {
      const { ok, data } = await post("/account/delete", { password });
      if (!ok) return { ok: false, error: extractError(data, "account deletion failed") };
      return { ok: true, erased: (data.erased as Record<string, number>) ?? {} };
    },
  };
}
