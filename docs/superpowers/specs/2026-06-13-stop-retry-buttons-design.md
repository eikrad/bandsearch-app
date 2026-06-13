# Stop / Retry buttons design

## Summary

Add a **stop** button (cancel in-flight search) and a **retry** button (re-run the last query) to the chat UI. Both appear on hover; stop lives under the `SearchInProgress` spinner, retry lives under the last user message bubble.

---

## UI

### Stop button
- Rendered inside `SearchInProgress` (`ChatAppView.ts`).
- Always present in the DOM while the spinner is visible; shown/hidden via CSS opacity transition on hover of the spinner container (`onMouseEnter` / `onMouseLeave`).
- Icon: `ti-player-stop` (Tabler outline), label: "stop".
- Ghost style matching existing action buttons: transparent background, `border: 1px solid ${theme.border}`, `border-radius: 4px`, `font-size: 11px`.
- Calls `handlers.onStop()`.

### Retry button
- Rendered inside `MessageThread` on the last message where `role === "user"` (determined by scanning the messages array in reverse).
- Same hover-reveal pattern as stop.
- Icon: `ti-refresh`, label: "retry".
- Same ghost style.
- Calls `handlers.onRetry()`.

---

## Data flow

### `chatClient.ts` — `fetchRecommendations`
Add optional `signal?: AbortSignal` as the last parameter. Pass it to the `fetch` call. No other changes.

### `bootstrapDesktopApp.ts` — app model
Two new pieces of state (module-level vars alongside the existing `state`):

```
currentAbortController: AbortController | null  — cleared after each call
lastQuery: string                               — set on every submit, never cleared
```

`requestRecommendations` changes:
1. Create `new AbortController()`, store as `currentAbortController`.
2. Append user message to state (existing behaviour).
3. Call `fetchRecommendations(..., currentAbortController.signal)`.
4. On `AbortError` (`error.name === "AbortError"`): remove the last user message from state, clear `currentAbortController`, return without throwing (silent cancel). The existing `isLoading` flag must also be cleared — ensure the finally/catch path that resets loading state runs for aborts too.
5. On any other error: clear `currentAbortController`, rethrow (existing error-surfacing path unchanged).
6. On success: clear `currentAbortController` (existing path unchanged).

Two new methods exposed on the returned model object:

```
cancelSearch()      — calls currentAbortController?.abort()
retryLastSearch()   — calls requestRecommendations(lastQuery, currentMode, currentObscurityTarget)
```

`retryLastSearch` is a no-op if `lastQuery` is empty or a search is already in flight.

### `desktopChatUiStack.ts`
Add `cancelSearch()` and `retryLastSearch()` to the stack interface and implementation, delegating to the app model.

### `createDesktopReactShell.ts`
Expose `cancelSearch()` and `retryLastSearch()` on the shell object.

### `mountDesktopReactApp.ts`
Add two handlers to the `handlers` object:

```
onStop:  () => shell.cancelSearch()   then renderCurrent()
onRetry: () => shell.retryLastSearch() then renderCurrent()
```

---

## State after cancel

When the user clicks stop:
- The in-flight HTTP request is aborted.
- The user message that was appended optimistically is removed from `state.messages`.
- `isLoading` returns to `false`.
- No error banner is shown — the thread simply returns to its pre-query state.
- `lastQuery` retains the cancelled query so retry is available.

---

## Out of scope

- No server-side cancellation — the API request is dropped client-side; the server will finish and discard the result.
- No "cancelled" indicator in the thread.
- No changes to the error message path for non-abort failures.
