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
