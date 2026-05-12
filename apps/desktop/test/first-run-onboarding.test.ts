import test from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_RUN_ONBOARDING_STORAGE_KEY,
  isDefaultHomeHash,
  shouldOfferWelcomeScreen,
} from "../src/firstRunOnboarding.js";

test("FIRST_RUN_ONBOARDING_STORAGE_KEY is stable for localStorage and docs", () => {
  assert.equal(FIRST_RUN_ONBOARDING_STORAGE_KEY, "bandsearch_onboarding_complete");
});

test("isDefaultHomeHash treats empty and root hashes as default home", () => {
  assert.equal(isDefaultHomeHash(""), true);
  assert.equal(isDefaultHomeHash("#"), true);
  assert.equal(isDefaultHomeHash("#/"), true);
});

test("isDefaultHomeHash is false for feature routes", () => {
  assert.equal(isDefaultHomeHash("#/saved"), false);
  assert.equal(isDefaultHomeHash("#/settings"), false);
  assert.equal(isDefaultHomeHash("#/welcome"), false);
});

test("shouldOfferWelcomeScreen is false when an API key is already stored", () => {
  assert.equal(
    shouldOfferWelcomeScreen({ hasStoredKey: true, onboardingComplete: false, locationHash: "" }),
    false,
  );
});

test("shouldOfferWelcomeScreen is false after onboarding was completed", () => {
  assert.equal(
    shouldOfferWelcomeScreen({ hasStoredKey: false, onboardingComplete: true, locationHash: "" }),
    false,
  );
});

test("shouldOfferWelcomeScreen is true on first launch with default hash and no key", () => {
  assert.equal(
    shouldOfferWelcomeScreen({ hasStoredKey: false, onboardingComplete: false, locationHash: "" }),
    true,
  );
  assert.equal(
    shouldOfferWelcomeScreen({ hasStoredKey: false, onboardingComplete: false, locationHash: "#/" }),
    true,
  );
});

test("shouldOfferWelcomeScreen is false when user opened a deep link without a key", () => {
  assert.equal(
    shouldOfferWelcomeScreen({ hasStoredKey: false, onboardingComplete: false, locationHash: "#/saved" }),
    false,
  );
});
