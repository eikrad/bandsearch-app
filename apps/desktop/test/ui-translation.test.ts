import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";

import { untranslatedText } from "./helpers/untranslated.js";
import { LoginView } from "../src/ui/LoginView.js";

/**
 * Every text a view shows comes from the catalog (#329): rendered in
 * i18next's `cimode`, a view must show keys only, apart from the data it is
 * given.
 */

test("the sign-in screen has no text of its own outside the catalog", async () => {
  const leftovers = await untranslatedText(
    React.createElement(LoginView, { viewProps: { error: "invalid credentials" }, handlers: {} }),
    ["invalid credentials"],
  );
  assert.deepEqual(leftovers, []);
});

import { RegisterView } from "../src/ui/RegisterView.js";
import { ResetPasswordView } from "../src/ui/ResetPasswordView.js";
import { WelcomeView } from "../src/ui/WelcomeView.js";
import { ConnectingView } from "../src/ui/ConnectingView.js";
import { UpdateBanner } from "../src/ui/UpdateBanner.js";
import { ObscurityTargetPicker } from "../src/ui/ObscurityTargetPicker.js";
import { FeedbackReactionBar } from "../src/ui/FeedbackReactionBar.js";

const noop = () => {};

test("the register screen, invite field included, has no text of its own outside the catalog", async () => {
  assert.deepEqual(await untranslatedText(React.createElement(RegisterView, { viewProps: { inviteRequired: true }, handlers: {} })), []);
});

test("the password reset screen has no text of its own outside the catalog", async () => {
  // The recovery code placeholder shows the code format, not language.
  const format = "xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx";
  assert.deepEqual(await untranslatedText(React.createElement(ResetPasswordView, { viewProps: {}, handlers: {} }), [format]), []);
});

test("the welcome screen has no text of its own outside the catalog", async () => {
  assert.deepEqual(await untranslatedText(React.createElement(WelcomeView, { handlers: {} })), []);
});

test("every connecting state has no text of its own outside the catalog", async () => {
  for (const viewProps of [{ state: "waiting" as const }, { state: "waiting" as const, attempt: 9 }, { state: "failed" as const }]) {
    assert.deepEqual(await untranslatedText(React.createElement(ConnectingView, { viewProps, handlers: { onRetry: noop } })), []);
  }
});

test("the update banner has no text of its own outside the catalog", async () => {
  for (const canAutoInstall of [true, false]) {
    const banner = React.createElement(UpdateBanner, { viewProps: { version: "0.5.0", canAutoInstall }, handlers: { onInstall: noop, onDismiss: noop } });
    assert.deepEqual(await untranslatedText(banner, ["0.5.0"]), []);
  }
});

test("the obscurity picker and the feedback bar have no text of their own outside the catalog", async () => {
  assert.deepEqual(await untranslatedText(React.createElement(ObscurityTargetPicker, { target: "underground", onTargetChange: noop })), []);
  assert.deepEqual(await untranslatedText(React.createElement(FeedbackReactionBar, { visible: true, onFeedback: noop, onDismiss: noop })), []);
});

import { SettingsView } from "../src/ui/SettingsView.js";

test("the settings screen has no text of its own outside the catalog, in any of its states", async () => {
  const handlers = { onExportAccountData: noop, onNavigatePrivacy: noop, onDeleteAccount: async () => {} };
  const states = [
    { hasStoredKey: false, hasBraveKey: false, accountsEnabled: true },
    { hasStoredKey: true, hasBraveKey: false, hasTursoConfig: true, apiEndpointUrl: "https://api.example.org" },
    { llmKeyFromEnv: true, braveKeyFromEnv: true, tursoFromEnv: true },
  ];
  for (const viewProps of states) {
    const leftovers = await untranslatedText(React.createElement(SettingsView, { viewProps, handlers }), [
      "https://api.example.org",
      // Examples of what to type, not language.
      "libsql://your-db.turso.io",
      "https://bandsearch-api.onrender.com",
    ]);
    assert.deepEqual(leftovers, [], JSON.stringify(viewProps));
  }
});

import { withKeysOnly, isKey } from "./helpers/untranslated.js";
import { createDesktopSettingsController } from "../src/desktopSettings.js";

test("every status message the settings screen shows comes from the catalog", async () => {
  const texts = await withKeysOnly(async () => {
    const seen: Array<string | undefined> = [];
    const ok = createDesktopSettingsController({ invokeTauri: async () => ({}), probeTursoConnection: async () => ({ ok: true }) });
    const collect = async () => {
      const p = await ok.getSettingsViewProps();
      seen.push(p.llmStatusMessage?.text, p.braveStatusMessage?.text, p.tursoStatusMessage?.text, p.apiEndpointStatusMessage?.text);
    };
    await ok.saveLlmApiKey(""); await ok.saveBraveApiKey(""); await ok.saveTursoConfig("", ""); await ok.saveApiEndpointUrl("not a url"); await collect();
    await ok.saveLlmApiKey("k"); await ok.saveBraveApiKey("k"); await ok.saveTursoConfig("libsql://x", "t"); await ok.saveApiEndpointUrl("https://x.example"); await collect();
    await ok.saveApiEndpointUrl(""); await ok.clearTursoConfig(); await collect();
    // Rejecting with nothing is what makes the controller fall back to its own message.
    const failing = createDesktopSettingsController({ invokeTauri: () => Promise.reject(null), probeTursoConnection: async () => ({ ok: false }) });
    await failing.saveLlmApiKey("k"); await failing.saveTursoConfig("libsql://x", "t"); await failing.saveApiEndpointUrl("https://x.example");
    const p = await failing.getSettingsViewProps().catch(() => null);
    seen.push(p?.llmStatusMessage?.text, p?.tursoStatusMessage?.text, p?.apiEndpointStatusMessage?.text);
    return seen.filter((text): text is string => typeof text === "string");
  });
  assert.ok(texts.length >= 12, `expected the statuses, got ${texts.length}`);
  assert.deepEqual(texts.filter((text) => !isKey(text)), []);
});

import { SavedArtistsView } from "../src/ui/SavedArtistsView.js";
import { savedArtistsViewProps } from "./helpers/fakeViewProps.js";

test("the saved artists screen has no text of its own outside the catalog, in any of its states", async () => {
  const data = ["Fen", "Alcest", "blackgaze", "Kept for the drums", "Post-black from England", "4/5", "Blackgaze", "Saved Artists", "Your style references"];
  const states = [
    savedArtistsViewProps({ isLoading: true }),
    savedArtistsViewProps(),
    savedArtistsViewProps({
      artists: [{ id: "a1", name: "Fen", rating: 4, categoryTags: ["blackgaze"], note: "Kept for the drums", isSelected: true }],
      selectedCount: 1,
      searchResults: [{ id: "mb1", name: "Alcest", disambiguation: "Post-black from England" }],
      groups: [{ id: "g1", name: "Blackgaze", memberIds: [] }],
    }),
    savedArtistsViewProps({ isSearching: true }),
  ];
  for (const viewProps of states) {
    assert.deepEqual(await untranslatedText(React.createElement(SavedArtistsView, { viewProps, handlers: {} }), data), []);
  }
});

import { createSavedArtistsShell, describeImport, type SavedArtistsShellCollaborator } from "../src/createSavedArtistsShell.js";

test("the saved artists screen's heading and import outcomes come from the catalog", async () => {
  const texts = await withKeysOnly(async () => {
    // The heading needs nothing from the app but the selection.
    const app = { getState: () => ({ selectedArtistIds: [] }) } as unknown as SavedArtistsShellCollaborator;
    const { header } = createSavedArtistsShell({ app }).getViewProps();
    return [
      header.title,
      header.subtitle,
      describeImport({ imported: 3, skipped: 0, failed: 0 }).message,
      describeImport({ imported: 1, skipped: 2, failed: 0 }).message,
      describeImport({ imported: 2, skipped: 0, failed: 1 }).message,
    ];
  });
  assert.deepEqual(texts.filter((text) => !isKey(text)), []);
});

import { formatRecommendationQueryError } from "../src/apiErrorMessages.js";
import { BandsearchHttpError } from "../src/chatClient.js";
import { PrivacyPolicyView } from "../src/ui/PrivacyPolicyView.js";
import { PRIVACY_POLICY } from "../src/ui/privacyPolicyText.js";

test("the error messages Bandsearch writes itself come from the catalog", async () => {
  const errors: unknown[] = [
    ...["rate_limit_exceeded", "recommendation_initializing", "recommendation_context_unavailable", "search_unavailable", "recommendation_unavailable", "validation_error"].map(
      (code) => new BandsearchHttpError("", { code, status: 400 }),
    ),
    new BandsearchHttpError("", { code: "http_error", status: 429 }),
    new BandsearchHttpError("", { code: "http_error", status: 503 }),
    new TypeError("fetch failed"),
    new Error("anything"),
  ];
  const texts = await withKeysOnly(() => errors.map(formatRecommendationQueryError));
  assert.deepEqual(texts.filter((text) => !isKey(text)), []);
});

test("the privacy screen's own frame comes from the catalog (the policy text follows with #349)", async () => {
  const policy = PRIVACY_POLICY.flatMap((section) => [section.heading, ...section.paragraphs]);
  assert.deepEqual(await untranslatedText(React.createElement(PrivacyPolicyView, { handlers: { onBack: noop } }), policy), []);
});
