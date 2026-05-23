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
