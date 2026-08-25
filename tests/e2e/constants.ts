/** Shared E2E static server port — keep in sync across Playwright and the local file server. */
export const E2E_FRONTEND_PORT = 4000;

/** The API the desktop bundle talks to; `startDesktopBrowserApp` defaults to this. */
export const E2E_API_PORT = 3001;
export const E2E_API_BASE_URL = `http://localhost:${E2E_API_PORT}`;

/**
 * A SQLite file used only by E2E runs, so the suite never registers its user into
 * the developer's `bandsearch.db`. Gitignored via the `*.db` rule.
 */
export const E2E_DATABASE_PATH = "e2e-bandsearch.db";

/** Where the authenticated browser state is cached between the setup project and the specs. */
export const E2E_STORAGE_STATE = "playwright/.auth/user.json";

/**
 * The account the setup project signs in as. Reused across runs: the first run
 * registers it, later runs log in, so the suite is green on a fresh checkout and
 * on a warm database alike.
 */
export const E2E_USER = {
  email: "e2e@bandsearch.test",
  displayName: "E2E Runner",
  password: "e2e-password-not-secret",
};

/** localStorage keys the desktop client gates its startup routing on. */
export const AUTH_TOKEN_STORAGE_KEY = "bandsearch_auth_token";
export const ONBOARDING_STORAGE_KEY = "bandsearch_onboarding_complete";
