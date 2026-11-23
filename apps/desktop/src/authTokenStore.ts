import { createPendingSearchStore } from "./pendingSearchStore.js";

const AUTH_TOKEN_KEY = "bandsearch_auth_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch { /* ignore */ }
}

export function clearAuthToken(): void {
  // A search belongs to the account whose credentials are being removed.
  createPendingSearchStore().clear();
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* ignore */ }
}
