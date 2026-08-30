import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LoginView } from "../src/ui/LoginView.js";
import { RegisterView } from "../src/ui/RegisterView.js";
import { ResetPasswordView } from "../src/ui/ResetPasswordView.js";
import { WelcomeView } from "../src/ui/WelcomeView.js";

/**
 * The four screens that stand between a new user and the app.
 *
 * None of them had a test: the E2E suite writes a token straight into
 * localStorage (tests/e2e/auth.setup.ts) so every spec starts past the auth
 * gate, and no unit test rendered them. A broken login form would have shipped
 * green.
 *
 * These render the initial markup, the same way the other view tests here do.
 * The submit handlers stay uncovered — driving a React form needs a DOM, and
 * this workspace deliberately carries no DOM library. The logic behind those
 * handlers is covered directly in auth-api-client.test.ts and
 * auth-token-store.test.ts.
 */

const noopLoginHandlers = { onLogin: async () => {}, onNavigateRegister: () => {}, onNavigateReset: () => {} };
const noopRegisterHandlers = {
  onRegister: async () => ({ recoveryCode: "" }),
  onDone: () => {},
  onNavigateLogin: () => {},
};
const noopResetHandlers = {
  onResetPassword: async () => ({ newRecoveryCode: "" }),
  onDone: () => {},
  onNavigateLogin: () => {},
};

function renderLogin(viewProps: { error?: string | null } = {}) {
  return renderToStaticMarkup(
    React.createElement(LoginView, { viewProps, handlers: noopLoginHandlers }),
  );
}

function renderRegister(viewProps: { error?: string | null } = {}) {
  return renderToStaticMarkup(
    React.createElement(RegisterView, { viewProps, handlers: noopRegisterHandlers }),
  );
}

function renderReset(viewProps: { error?: string | null } = {}) {
  return renderToStaticMarkup(
    React.createElement(ResetPasswordView, { viewProps, handlers: noopResetHandlers }),
  );
}

// ----------------------------------------------------------------- login

test("LoginView renders a sign-in heading", () => {
  assert.match(renderLogin(), /Sign in/);
});

test("LoginView renders an email and a password field", () => {
  const html = renderLogin();

  assert.match(html, /type="email"/);
  assert.match(html, /type="password"/);
  assert.match(html, /Email/);
  assert.match(html, /Password/);
});

test("LoginView marks both fields required", () => {
  const html = renderLogin();

  // The form's only guard against an empty submit is the required attribute
  // plus the handler's own trim check.
  assert.equal(html.match(/required=""/g)?.length, 2);
});

test("LoginView sets autocomplete hints for password managers", () => {
  const html = renderLogin();

  // Matched case-insensitively: React emits the prop name as written, and HTML
  // attribute names are case-insensitive, so the browser reads it either way.
  assert.match(html, /autocomplete="email"/i);
  assert.match(html, /autocomplete="current-password"/i);
});

test("LoginView renders the error prop", () => {
  assert.match(renderLogin({ error: "invalid credentials" }), /invalid credentials/);
});

test("LoginView renders no error text when the prop is absent", () => {
  assert.doesNotMatch(renderLogin(), /invalid credentials/);
});

test("LoginView offers routes to register and to password reset", () => {
  const html = renderLogin();

  assert.match(html, /Create an account/);
  assert.match(html, /Forgot password\? Use recovery code/);
});

test("LoginView starts with an enabled submit button", () => {
  assert.doesNotMatch(renderLogin(), /disabled/);
});

// -------------------------------------------------------------- register

test("RegisterView renders a create-account heading", () => {
  assert.match(renderRegister(), /Create account/);
});

test("RegisterView renders email, display name and password fields", () => {
  const html = renderRegister();

  assert.match(html, /Email/);
  assert.match(html, /Display name/);
  assert.match(html, /Password/);
  assert.match(html, /type="email"/);
  assert.match(html, /type="password"/);
});

test("RegisterView renders the error prop", () => {
  assert.match(renderRegister({ error: "registration is currently closed" }), /registration is currently closed/);
});

test("RegisterView does not show a recovery code before submitting", () => {
  // The recovery code panel replaces the form, and is reachable only after a
  // successful register call.
  assert.doesNotMatch(renderRegister(), /Recovery code/);
});

test("RegisterView offers a route back to sign in", () => {
  assert.match(renderRegister(), /Already have an account\? Sign in/);
});

// -------------------------------------------------------- reset password

test("ResetPasswordView renders a reset-password heading", () => {
  assert.match(renderReset(), /Reset password/);
});

test("ResetPasswordView renders email, recovery code and new password fields", () => {
  const html = renderReset();

  assert.match(html, /Email/);
  assert.match(html, /Recovery code/);
  assert.match(html, /New password/);
});

test("ResetPasswordView explains what the recovery code is", () => {
  assert.match(renderReset(), /recovery code you received when creating your account/);
});

test("ResetPasswordView renders the error prop", () => {
  assert.match(renderReset({ error: "invalid recovery code" }), /invalid recovery code/);
});

test("ResetPasswordView does not show a new recovery code before submitting", () => {
  assert.doesNotMatch(renderReset(), /New recovery code/);
});

test("ResetPasswordView offers a route back to sign in", () => {
  assert.match(renderReset(), /Back to sign in/);
});

// --------------------------------------------------------------- welcome

test("WelcomeView renders the onboarding headline", () => {
  const html = renderToStaticMarkup(
    React.createElement(WelcomeView, { viewProps: {}, handlers: { onGoToSettings: () => {}, onSkip: () => {} } }),
  );

  assert.match(html, /Welcome to Bandsearch/);
});

test("WelcomeView explains why an API key is needed", () => {
  const html = renderToStaticMarkup(
    React.createElement(WelcomeView, { viewProps: {}, handlers: { onGoToSettings: () => {}, onSkip: () => {} } }),
  );

  assert.match(html, /Gemini API key/);
});

test("WelcomeView offers both adding a key and skipping", () => {
  const html = renderToStaticMarkup(
    React.createElement(WelcomeView, { viewProps: {}, handlers: { onGoToSettings: () => {}, onSkip: () => {} } }),
  );

  // Skipping has to stay available, or a user with no key is stuck on this
  // screen with no way into the app.
  assert.match(html, /Add API key/);
  assert.match(html, /Skip for now/);
});
