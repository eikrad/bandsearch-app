import { expect, test as setup } from "@playwright/test";
import {
  AUTH_TOKEN_STORAGE_KEY,
  E2E_API_BASE_URL,
  E2E_STORAGE_STATE,
  E2E_USER,
  ONBOARDING_STORAGE_KEY,
} from "./constants.js";

/**
 * Signs the suite in before any spec runs.
 *
 * `startDesktopBrowserApp` gates startup on two things before it will show the
 * chat screen: onboarding must be finished, and — once the API reports any
 * registered user — a token must be present. Without this the specs land on
 * `#/login` or `#/welcome`, where none of the chat locators exist.
 */
setup("authenticate", async ({ page, request }) => {
  const registered = await request.post(`${E2E_API_BASE_URL}/auth/register`, { data: E2E_USER });

  // A warm database already has this account, so registration is expected to
  // fail on every run after the first. Fall back to logging the same user in.
  let token: string;
  if (registered.ok()) {
    token = (await registered.json()).token;
  } else {
    const loggedIn = await request.post(`${E2E_API_BASE_URL}/auth/login`, {
      data: { email: E2E_USER.email, password: E2E_USER.password },
    });
    expect(
      loggedIn.ok(),
      `could not register or log in the E2E user (register: ${registered.status()}, login: ${loggedIn.status()})`,
    ).toBeTruthy();
    token = (await loggedIn.json()).token;
  }
  expect(token, "auth endpoint returned no token").toBeTruthy();

  // The token lives in localStorage, which is per-origin, so it has to be written
  // from a page on the app's origin rather than from the API request context.
  await page.goto("/");
  await page.evaluate(
    ([tokenKey, tokenValue, onboardingKey]) => {
      localStorage.setItem(tokenKey, tokenValue);
      localStorage.setItem(onboardingKey, "1");
    },
    [AUTH_TOKEN_STORAGE_KEY, token, ONBOARDING_STORAGE_KEY] as const,
  );

  await page.context().storageState({ path: E2E_STORAGE_STATE });
});
