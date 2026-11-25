# Android Chat layout prototype — #334

Throwaway branch `prototype/android-chat-layout`, based on `origin/staging`
`eeec61b`. Never merge; no PR. The owner has not chosen a layout yet.

## Run

- `npm run prototype:android-chat` writes a self-contained HTML file at
  `/tmp/bandsearch-android-chat-prototype.html`.
- Open it at 360 px with `?variant=A#/chat`, `?variant=B#/chat`, or
  `?variant=C#/chat`. The bottom arrows change variants without clearing state.
- Tap the variant name to show instrumentation: reset sample, restored-chat
  bar, feedback bar and a simulated 457 px visual viewport.
- `npm run prototype:android-chat -- --phone` uses the installed debug APK's
  WebView over ADB. It navigates to a fresh `about:blank` document and supplies
  the self-contained HTML; it does not install an APK or access account data.
  On the phone the variant parameter lives in the hash (for example
  `about:blank#/chat?variant=B`), since blank pages cannot change their query.
  Force-stop and reopen Bandsearch to return to the installed app.

All mutations are in-memory sample interactions. No actual search, server
chat mutation, or account export is exercised. Copy uses the clipboard;
external links report their destination without leaving the sample.

## What varies

- **A — Full composer:** fixed header, scrolling transcript, pinned obscurity
  picker, stacked input and Recommend, unchanged disclosure below the input.
  Earlier picks collapse.
- **B — Compact composer:** fixed header, scrolling transcript, pinned picker
  and input/Recommend row. Disclosure is at the start of the transcript and
  feedback follows the latest batch. Earlier picks collapse. Moving disclosure
  is a candidate for owner approval, not an accepted spec change.
- **C — Scrolling page:** header, all earlier cards and full composer scroll as
  one page. The composer is reached after the cards.

Common: actual ChatAppView message/card renderer, locked palette and sizes,
44 px minimum targets, two-row card actions, title/Chats/New chat header row
plus mode row. Chat list, rename, delete/undo, new/continued chat and tab-bar
placement are sample interactions. Category/Note is the current inline editor;
its alternatives belong to #335. The variant bar reserves 48 px; account for
that space when comparing with the final product.

## Local observations (Chromium, 360 × 792)

- No document horizontal overflow in A/B/C.
- Visible buttons, inputs, links and summaries met 44 × 44 px in the sampled
  English states. Renamed chat, deleted it, undid deletion, and reopened it.
- With a simulated visual viewport of 457 px, A's composer is 219 px high and
  B's is 105 px high. Remaining transcript: A 83 px, B 197 px. This is **without
  phone safe-area insets**, and with the 48 px prototype bar included.
- C's composer follows about 1,366 px of transcript in this sample; scrolling
  to the input is necessary. This is the alternative being evaluated.
- These are local layout observations, not a real IME or Android-back result.

## Phone status

After USB reconnection, the prototype loaded successfully into the installed
OPPO CPH2709 debug WebView. Tauri's local assets bypass CDP Fetch interception,
so the loader uses `Page.navigate(about:blank)` and `Page.setDocumentContent`.
The fresh document removes the installed app's running JavaScript context.

Measured with the keyboard closed: width 360 px, visual viewport 792.67 px,
top safe-area padding 40 px, bottom inset 16 px (plus the 48 px prototype bar).
No horizontal overflow or undersized visible controls. A's composer is 234.58
px on this WebView; B's is 105 px. A/B variant switching retains sample state.
The screen slept during the keyboard test; automated touch injection did not
reliably open the IME. Real keyboard and Back checks await a manual tap.
No APK was replaced and no account data was changed.

## Still needed on the phone

Compare A/B/C with the real keyboard open; inspect header fit and insets,
scroll cards while typing, toggle stars and Save, inspect the status slot,
open the chat list, rename and undo deletion. Back should dismiss the IME first
and walk from Chats to Chat. Record actual heights and the owner's chosen
combination on #334; then update the final spec during #314's handoff.

## Validation

`npm test` passed before capture; desktop typecheck and lint passed. Catalog
translation generated German and Danish drafts; none were marked reviewed.
The production entry point does not import the prototype. Normal app builds
therefore omit its entry, CSS and switcher.
