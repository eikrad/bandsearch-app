/** localStorage / config flag: user finished welcome (saved key or chose skip). */
export const FIRST_RUN_ONBOARDING_STORAGE_KEY = "bandsearch_onboarding_complete";

export function isDefaultHomeHash(locationHash: string): boolean {
  const h = locationHash ?? "";
  return h === "" || h === "#" || h === "#/";
}

/**
 * First launch: offer welcome when there is no API key, onboarding is not done,
 * and the user landed on the default home hash (not a deep link).
 */
export function shouldOfferWelcomeScreen(input: {
  hasStoredKey: boolean;
  onboardingComplete: boolean;
  locationHash: string;
}): boolean {
  if (input.hasStoredKey || input.onboardingComplete) return false;
  return isDefaultHomeHash(input.locationHash);
}
