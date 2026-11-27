# Android Category/Note editor prototype — #335

Throwaway branch `prototype/android-note-sheet`, built on
`prototype/android-chat-layout` (#334, approved layout B). Never merge; no PR.
**Nothing here is built in the product.** The chosen pattern goes into the
rewritten #156/#154 at the #314 handoff.

## Run

- `npm run prototype:android-note` writes a self-contained HTML file at
  `/tmp/bandsearch-android-note-prototype.html`. Open it at 360 px with
  `?variant=A#/chat`, `?variant=B#/chat` or `?variant=C#/chat`.
- `npm run prototype:android-note -- --phone` loads it into the installed debug
  APK's WebView over ADB, as for #334 (sample data only; force-stop and reopen
  Bandsearch to return to the installed app).
- Tap `···` on a card to open the editor. Tap the variant name for the
  instrumentation; "Simulate keyboard" limits the visible area to 457 px.

## What varies

The Chat screen is #334's B in all three. Only the container of the editor
behind `···` changes; the editor inside is the real `CategoryNoteSheet`, with
its controls raised to 44 px and 16 px input text (no zoom on focus).

- **A — Inline in the card:** today's panel, opening inside the card in the
  transcript. No history entry: Back leaves the Chat screen.
- **B — Bottom sheet:** over the tab bar with a dimmed backdrop. Its bottom edge
  follows the visible area, so the keyboard pushes it up; its height is capped
  to the visible area. Header: band name and `×`. One history entry: Back (or
  `×`, Cancel, Save, a tap on the backdrop) closes it.
- **C — Full screen:** an edge screen with `←` and the band name, filling the
  visible area. One history entry: Back closes it.

## Local measurements (Chromium, 360 × 792, 2026-11-27)

| | keyboard closed | simulated keyboard (457 px visible) |
|---|---|---|
| A | editor 341 px inside the transcript | editor top at −43 px: only the Note textarea is in view; Category and the hint are scrolled away, Save at 242–286 px |
| B | sheet 396 px, Save at 736–780 | sheet 61–457 px; everything visible, Save at 401–445 |
| C | full screen, textarea 132 px, Save at 404–448 | the same; everything visible |

- No horizontal overflow, no editor control below 44 × 44 px, in all six states.
- B and C: `history.back()` closed the editor in every run.
- These are not real IME results. The phone check (owner) is the comparison.

## Found on the way

- **#379:** both editor labels get their style as props, so "Note" runs into
  the AI hint on desktop too. The prototype works around it in CSS.
- **Saved Artists has no Category/Note editor at all**: it shows categories
  read-only (`SavedArtistsView.ts:60`). Whether the phone editor also opens from
  Saved Artists is a scope question for the owner, not part of the layout.
- The editor's texts are written into the view instead of `en.json`; noted on #379.
