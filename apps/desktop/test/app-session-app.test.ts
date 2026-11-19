import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { startDesktopBrowserApp } from "../src/startDesktopBrowserApp.js";
import { bootstrapDesktopReactApp } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { fakeContainer, fakeReactRoot, routedViewOf } from "./helpers/fakeDom.js";
import { fakeUpdateStorage } from "./helpers/fakeStorage.js";

// The whole chain, as the user meets it: the real startup, session, router and
// mount, against a fake API. Only the React root and the browser globals are
// stand-ins. Each test is one of the #313 bugs.

type Screen = ReactElement<{ viewProps: Record<string, unknown>; handlers: Record<string, (...args: unknown[]) => unknown> }>;
type AuthState = { enabled: boolean; userCount: number; inviteRequired: boolean };

async function bootApp({
  auth,
  firstLaunch = false,
  token = null as string | null,
}: { auth: AuthState; firstLaunch?: boolean; token?: string | null }) {
  const saved = {
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
  };
  const storage = new Map<string, string>(token ? [["bandsearch_auth_token", token]] : []);
  Object.defineProperty(globalThis, "location", { value: { hash: "" }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    },
    configurable: true,
    writable: true,
  });
  const restore = () => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };

  const screens: Screen[] = [];
  try {
    await startDesktopBrowserApp({
      invokeTauri: async (cmd) =>
        cmd === "llm_config_status" ? { hasStoredKey: !firstLaunch, onboardingComplete: !firstLaunch } : {},
      updateDismissalStorage: fakeUpdateStorage(),
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/auth/status") return jsonResponse(auth);
        if (path === "/auth/register") {
          auth.userCount += 1;
          return jsonResponse({ token: "t-new", recoveryCode: "RC", user: { id: "u1" } });
        }
        if (path === "/account/delete") {
          auth.userCount -= 1;
          return jsonResponse({ erased: {} });
        }
        return jsonResponse({});
      },
      sleep: async () => {},
      now: () => 0,
      deps: {
        bootstrapDesktopReactApp: (options) => bootstrapDesktopReactApp({
          ...options,
          createRootImpl: () => fakeReactRoot((element) => { screens.push(routedViewOf(element) as Screen); }),
          resolveContainer: () => fakeContainer(),
        }),
      },
    });
  } catch (error) {
    restore();
    throw error;
  }

  const screen = () => {
    const last = screens.at(-1);
    assert.ok(last, "something should be on screen");
    return last;
  };
  return {
    restore,
    screenName: () => {
      const type = screen().type;
      return typeof type === "function" ? type.name : String(type);
    },
    handlers: () => screen().props.handlers,
    viewProps: () => screen().props.viewProps,
    token: () => storage.get("bandsearch_auth_token") ?? null,
  };
}

test("Skip on Welcome leads to login on a deployment with accounts, not into the chat", async () => {
  const app = await bootApp({ auth: { enabled: true, userCount: 2, inviteRequired: false }, firstLaunch: true });
  try {
    assert.equal(app.screenName(), "WelcomeView");

    await app.handlers().onSkip();

    assert.equal(app.screenName(), "LoginView");
  } finally {
    app.restore();
  }
});

test("after registering the first account, Settings offers export and deletion straight away", async () => {
  const app = await bootApp({ auth: { enabled: true, userCount: 0, inviteRequired: false } });
  try {
    assert.equal(app.screenName(), "RegisterView");

    await app.handlers().onRegister("a@b.c", "A", "long-enough-pw");
    await app.handlers().onDone();
    assert.equal(app.screenName(), "ChatAppView");
    await app.handlers().onNavigateSettings();

    assert.equal(app.screenName(), "SettingsView");
    assert.equal(app.viewProps().accountsEnabled, true);
  } finally {
    app.restore();
  }
});

test("deleting an account on a closed deployment with other users leads to login", async () => {
  const app = await bootApp({ auth: { enabled: true, userCount: 3, inviteRequired: true }, token: "t-old" });
  try {
    await app.handlers().onNavigateSettings();
    assert.equal(app.screenName(), "SettingsView");

    await app.handlers().onDeleteAccount("pw");

    assert.equal(app.token(), null);
    assert.equal(app.screenName(), "LoginView", "Register would ask for an invite the user no longer has");
  } finally {
    app.restore();
  }
});
