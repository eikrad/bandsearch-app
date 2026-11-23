import type { AuthApiClient, AuthStatus } from "./authApiClient.js";
import { decideAuthRoute } from "./authGate.js";
import { waitForAuthStatus } from "./waitForApi.js";
import type { ConnectingViewProps } from "./ui/viewTypes.js";
import type { Route } from "./createHashRouter.js";

/** Screens that exist to get the user in. A let-in user is never left on one. */
const GATE_SCREENS = new Set<Route>(["welcome", "connecting", "login", "register", "reset-password"]);

export type AppSessionDeps = {
  auth: Pick<AuthApiClient, "getAuthStatus" | "login" | "register" | "resetPassword" | "deleteAccount">;
  token: { get(): string | null; set(token: string): void; clear(): void };
  /** Must tell its listeners inside navigate(), so moving the user also repaints. */
  router: { getRoute(): Route; navigate(route: Route): void };
  /** Injected so tests drive the Connecting retries instead of waiting them out. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type AppSession = ReturnType<typeof createAppSession>;

/**
 * Decides which screen the user may see: Welcome, Connecting, Login, Register,
 * or the app. It owns everything that decision reads (the account flags from
 * `/auth/status`, the token, the Connecting progress) and every event that
 * changes it.
 *
 * The rule of the interface: events only change the token; `enterApp()` asks
 * the API and routes. Asking again rather than guessing is what keeps the
 * account flags right after a registration or a deletion (#313).
 */
export function createAppSession({ auth, token, router, sleep, now }: AppSessionDeps) {
  let accountsEnabled = false;
  let inviteRequired = false;
  let connectingViewProps: ConnectingViewProps = { state: "waiting" };
  // Whether the last answer let the user in. Until it has, entering the chat
  // goes through the gate rather than straight to the chat screen.
  let letIn = false;
  // Guards Retry: a double click would otherwise start a second polling loop.
  let polling = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** Records what the answer says and returns where it sends the user. */
  function decide(status: AuthStatus) {
    accountsEnabled = status.reachable && status.enabled && status.userCount > 0;
    inviteRequired = status.reachable && status.inviteRequired;
    const route = decideAuthRoute({ status, hasToken: Boolean(token.get()) });
    letIn = route === "app";
    return route;
  }

  /**
   * Sends the user where `route` says. `appRoute` is where a let-in user goes;
   * null keeps the current screen (a deep link at startup).
   */
  function arrive(route: ReturnType<typeof decide>, appRoute: Route | null): void {
    if (route === "unavailable") {
      connectingViewProps = { state: "waiting", attempt: 1 };
      router.navigate("connecting");
      return;
    }
    if (route !== "app") {
      router.navigate(route);
      return;
    }
    const target = appRoute ?? (GATE_SCREENS.has(router.getRoute()) ? "home" : null);
    if (target) router.navigate(target);
  }

  /** Keeps asking until the API answers or the budget runs out, then routes. */
  async function connect(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const status = await waitForAuthStatus({
        getStatus: () => auth.getAuthStatus(),
        sleep,
        now,
        onAttempt: ({ attempt }) => {
          // The check that sent the user here was attempt 1.
          connectingViewProps = { state: "waiting", attempt: attempt + 1 };
          notify();
        },
      });
      const route = decide(status);
      if (route === "unavailable") {
        if (!status.reachable) console.warn("[bandsearch] API unreachable:", status.reason);
        connectingViewProps = { state: "failed" };
        notify();
        return;
      }
      arrive(route, "home");
    } finally {
      polling = false;
    }
  }

  return {
    /**
     * Routes on one quick check, so a healthy API reaches the right screen with
     * no detour. Polling waits for `connectIfWaiting()`, after the UI is
     * mounted, so the retries happen with the Connecting screen showing rather
     * than behind a blank window.
     */
    async start({ offerWelcome }: { offerWelcome: boolean }): Promise<void> {
      if (offerWelcome) {
        router.navigate("welcome");
        return;
      }
      arrive(decide(await auth.getAuthStatus()), null);
    },

    /** Call once something is on screen: keeps trying if startup found the API down. */
    async connectIfWaiting(): Promise<void> {
      if (router.getRoute() === "connecting") await connect();
    },

    /** The Connecting screen's Retry, after the budget ran out. */
    async retry(): Promise<void> {
      connectingViewProps = { state: "waiting", attempt: 1 };
      notify();
      await connect();
    },

    /**
     * Every way into the chat: Skip on Welcome, Done after registering, a
     * login, the back arrow from Settings or Saved. A let-in user goes straight
     * there; anyone else is routed by a fresh answer from the API.
     */
    async enterApp(): Promise<void> {
      if (letIn) {
        router.navigate("home");
        return;
      }
      const route = decide(await auth.getAuthStatus());
      arrive(route, "home");
      if (route === "unavailable") await connect();
    },

    async login(email: string, password: string): Promise<void> {
      const result = await auth.login({ email, password });
      if (result.ok === false) throw new Error(result.error);
      token.set(result.token);
      letIn = false;
    },

    async register(email: string, displayName: string, password: string, inviteCode?: string): Promise<{ recoveryCode: string }> {
      const result = await auth.register({ email, displayName, password, inviteCode });
      if (result.ok === false) throw new Error(result.error);
      token.set(result.token);
      letIn = false;
      return { recoveryCode: result.recoveryCode };
    },

    async resetPassword(email: string, recoveryCode: string, newPassword: string): Promise<{ newRecoveryCode: string }> {
      const result = await auth.resetPassword({ email, recoveryCode, newPassword });
      if (result.ok === false) throw new Error(result.error);
      token.clear();
      letIn = false;
      return { newRecoveryCode: result.newRecoveryCode };
    },

    async deleteAccount(password: string): Promise<{ ok: boolean; error?: string }> {
      const result = await auth.deleteAccount({ password });
      if (result.ok === false) return { ok: false, error: result.error };
      token.clear();
      letIn = false;
      return { ok: true };
    },

    /** The API refused the stored token. */
    unauthorized(): void {
      token.clear();
      letIn = false;
      router.navigate("login");
    },

    /** Whether there is an account to export or delete; Settings hides that section otherwise. */
    accountsEnabled: () => accountsEnabled,
    inviteRequired: () => inviteRequired,
    connectingViewProps: () => connectingViewProps,

    /** Calls `listener` when the Connecting progress changes without a navigation. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
