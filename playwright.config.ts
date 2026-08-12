import { defineConfig } from "@playwright/test";
import { E2E_FRONTEND_PORT } from "./tests/e2e/constants.js";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 40000,
  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: "node --import tsx services/api/src/server.ts",
      port: 3001,
      reuseExistingServer: false,
      timeout: 15000,
      env: { PORT: "3001" },
    },
    {
      command: "npx tsx tests/e2e/serve-frontend.ts",
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 5000,
    },
  ],
});
