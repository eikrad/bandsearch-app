export type AuthUser = { id: string; email: string; displayName: string; createdAt: string };

export type AuthStatus = { enabled: boolean; userCount: number };

export type RegisterResult =
  | { ok: true; user: AuthUser; token: string; recoveryCode: string }
  | { ok: false; error: string };

export type LoginResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; error: string };

export type ResetPasswordResult =
  | { ok: true; newRecoveryCode: string }
  | { ok: false; error: string };

export type AuthApiClient = {
  getAuthStatus(): Promise<AuthStatus>;
  register(input: { email: string; displayName: string; password: string }): Promise<RegisterResult>;
  login(input: { email: string; password: string }): Promise<LoginResult>;
  resetPassword(input: { email: string; recoveryCode: string; newPassword: string }): Promise<ResetPasswordResult>;
};

type ApiErrorBody = { message?: string };

export function createAuthApiClient({
  apiBaseUrl,
  fetchImpl = fetch,
}: {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}): AuthApiClient {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  async function post(path: string, body: Record<string, string>) {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
        if (!res.ok) return { enabled: false, userCount: 0 };
        const data = (await res.json()) as AuthStatus;
        return { enabled: Boolean(data.enabled), userCount: Number(data.userCount) || 0 };
      } catch {
        return { enabled: false, userCount: 0 };
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
  };
}
