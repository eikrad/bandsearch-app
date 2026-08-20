import { defineConfig } from "@playwright/test";
import {
  E2E_API_PORT,
  E2E_DATABASE_PATH,
  E2E_FRONTEND_PORT,
  E2E_STORAGE_STATE,
} from "./tests/e2e/constants.js";

export default defineConfig({
  testDir: "./tests/e2e",
  // Generous because the opt-in `@live` specs wait on the real research pipeline;
  // the default suite finishes each test in well under a second. See
  // LIVE_PIPELINE_TIMEOUT_MS in recommendation.spec.ts.
  timeout: 200_000,
  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    headless: true,
  },
  projects: [
    // Signs in once and caches the browser state; see auth.setup.ts.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { storageState: E2E_STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node --import tsx services/api/src/server.ts",
      port: E2E_API_PORT,
      reuseExistingServer: false,
      timeout: 15000,
      // Its own database: the suite registers a user, and that must not land in
      // the developer's bandsearch.db (where it would also change the auth-status
      // user count the desktop client routes on).
      env: { PORT: String(E2E_API_PORT), DATABASE_PATH: E2E_DATABASE_PATH },
    },
    {
      command: "npx tsx tests/e2e/serve-frontend.ts",
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 5000,
    },
  ],
});
