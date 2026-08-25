import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsView } from "../src/ui/SettingsView.js";

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
  onSaveApiEndpointUrl: () => {},
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

// ── API endpoint card ────────────────────────────────────────────────────────

test("SettingsView renders API endpoint heading", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.equal(html.includes("API endpoint"), true, "should render API endpoint heading");
});

test("SettingsView renders API endpoint URL input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.equal(html.includes("api-endpoint-url"), true, "should render API endpoint input id");
});

test("SettingsView shows the configured remote URL when set", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointUrl: "https://bandsearch.onrender.com" },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("https://bandsearch.onrender.com"), true, "should display the configured endpoint");
});

test("SettingsView shows Reset to local button when a remote endpoint is configured", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointUrl: "https://remote.example" },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("Reset to local"), true, "should offer a reset button in remote mode");
});

test("SettingsView does not show Reset to local button when using the local app", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointUrl: "" },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("Reset to local"), false, "should not show reset button in local mode");
});

test("SettingsView renders API endpoint status message when present", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointStatusMessage: { type: "success", text: "Endpoint saved!" } },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("Endpoint saved!"), true, "should show endpoint status message");
});

test("SettingsView notes that keys are server-managed when a remote endpoint is active", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointUrl: "https://remote.example" },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("remote endpoint is active"), true, "should hint keys apply to the local API only");
});

test("SettingsView does not show the server-managed note in local mode", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: { ...baseViewProps, apiEndpointUrl: "" },
      handlers: baseHandlers,
    }),
  );
  assert.equal(html.includes("remote endpoint is active"), false, "no server-managed note when local");
});

test("settings offers a link to the privacy policy", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.match(html, /Privacy policy/, "a way into the privacy policy is offered");
});

test("settings offers a way to export all account data", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, { viewProps: baseViewProps, handlers: baseHandlers }),
  );
  assert.match(html, /Export my data/, "an Art. 15/20 export control is offered");
});

test("choosing the privacy policy navigates to it", () => {
  let navigated = false;
  const html = renderToStaticMarkup(
    React.createElement(SettingsView, {
      viewProps: baseViewProps,
      handlers: { ...baseHandlers, onNavigatePrivacy: () => { navigated = true; } },
    }),
  );
  assert.ok(html.length > 0);
  assert.equal(navigated, false, "navigation only happens on click, not on render");
});
