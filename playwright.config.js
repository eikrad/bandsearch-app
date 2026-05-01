const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 40000,
  use: {
    baseURL: "http://localhost:4000",
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
      port: 4000,
      reuseExistingServer: false,
      timeout: 5000,
    },
  ],
});
