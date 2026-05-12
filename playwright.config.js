const { defineConfig } = require("@playwright/test");
const { E2E_FRONTEND_PORT } = require("./tests/e2e/constants");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 40000,
  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: "node services/api/src/server.js",
      port: 3001,
      reuseExistingServer: false,
      timeout: 15000,
      env: { PORT: "3001" },
    },
    {
      command: "node tests/e2e/serve-frontend.js",
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: false,
      timeout: 5000,
    },
  ],
});
