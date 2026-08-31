const CHAT_SESSION_ID_KEY = "bandsearch_chat_session_id";

export function getChatSessionId(): string | null {
  try {
    return localStorage.getItem(CHAT_SESSION_ID_KEY);
  } catch {
    return null;
  }
}

export function setChatSessionId(sessionId: string): void {
  try {
    localStorage.setItem(CHAT_SESSION_ID_KEY, sessionId);
  } catch { /* ignore */ }
}
