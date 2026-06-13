const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { SettingsView } = require("../src/ui/SettingsView");

const baseViewProps = {
  headerTitle: "Settings",
  headerSubtitle: "",
  hasStoredKey: false,
  hasBraveKey: false,
  hasTursoConfig: false,
  statusMessage: null,
  geminiStatusMessage: null,
  braveStatusMessage: null,
  tursoStatusMessage: null,
};

const baseHandlers = {
  onNavigateChat: () => {},
  onSaveApiKey: () => {},
  onSaveBraveApiKey: () => {},
  onSaveTursoConfig: () => {},
};

test("SettingsView renders Turso section heading", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.equal(html.includes("Turso"), true, "should render Turso heading");
});

test("SettingsView renders Turso database URL input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.equal(html.includes("turso-database-url"), true, "should render Turso URL input id");
});

test("SettingsView renders Turso auth token input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.equal(html.includes("turso-auth-token"), true, "should render Turso token input id");
});

test("SettingsView renders info banner when hasTursoConfig is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasTursoConfig: false },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("cross-device") || html.includes("Turso") || html.includes("sync"), true,
    "should render an info hint about Turso sync when not configured");
});

test("SettingsView renders Turso status message when present", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, tursoStatusMessage: { type: "success", text: "Turso connected!" } },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("Turso connected!"), true, "should show turso status message");
});

// ── from-env presence states ────────────────────────────────────────────────

test("SettingsView shows 'from .env' status for Gemini key when geminiKeyFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasStoredKey: true, geminiKeyFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("loaded from .env"), true, "should announce env-loaded key");
});

test("SettingsView does not render gemini input when geminiKeyFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasStoredKey: true, geminiKeyFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes('id="gemini-api-key"'), false, "gemini input should be hidden behind Override");
});

test("SettingsView shows Override button when geminiKeyFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasStoredKey: true, geminiKeyFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("Override"), true, "should offer an Override button");
});

test("SettingsView shows 'from .env' status for Brave key when braveKeyFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasBraveKey: true, braveKeyFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("loaded from .env"), true, "should announce env-loaded brave key");
});

test("SettingsView does not render brave input when braveKeyFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasBraveKey: true, braveKeyFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes('id="brave-api-key"'), false, "brave input should be hidden behind Override");
});

test("SettingsView shows 'from .env' status for Turso when tursoFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasTursoConfig: true, tursoFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("loaded from .env"), true, "should announce env-loaded turso config");
});

test("SettingsView does not render turso inputs when tursoFromEnv is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasTursoConfig: true, tursoFromEnv: true },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes('id="turso-database-url"'), false, "turso inputs should be hidden behind Override");
});

test("SettingsView does not show missing-key banner when keys are from env", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: {
        ...baseViewProps,
        hasStoredKey: true,
        hasBraveKey: true,
        geminiKeyFromEnv: true,
        braveKeyFromEnv: true,
      },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("not configured yet"), false, "should not warn when keys come from env");
});

test("SettingsView shows Switch back to SQLite button when Turso is configured and not from env", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, hasTursoConfig: true },
      handlers: { ...baseHandlers, onClearTursoConfig: () => {} },
    }),
  );
  assert.equal(html.includes("Switch back"), true, "should show switch-back button when Turso is configured");
});
