# ADR 0002 — Machine-written notes stay out of the recommendation prompt

**Status:** Accepted — **not yet implemented**, tracked in #166
**Date:** 2026-08-30

> The decision below stands; the code does not do it yet. Every note still
> reaches the prompt regardless of who wrote it. Read "does" in the Decision
> section as "will".

## Context

Saving a band from a recommendation card pre-fills its `note` with the model's
own explanation of why it recommended the artist (`bootstrapDesktopApp.ts`:
`note: options.note || recommendation?.why || …`).

That note is then read back into the preference context on the next request
(`savedBandContext.ts`), formatted as `note: <text>` alongside the user's
rating and categories — that is, presented to the model as the user's own words.

So the model writes "atmospheric slowcore with tape hiss", the user saves the
band, and on the next query the model reads back what looks like independent
confirmation from the user of a preference the model itself introduced. Across
many queries this narrows recommendations toward the model's own vocabulary,
and the narrowing is invisible: nothing distinguishes a note the user wrote from
one the system pre-filled.

Notes are currently not editable anywhere in the UI, so in practice *every*
note in the system is machine-written. The `···` overflow that the design spec
assigns to Category/Note was never implemented, which is why this went unnoticed.

## Decision

**Only a note the user has written or edited enters the preference context.**

A note still left at its pre-filled value stays stored and stays visible in the
UI — it answers "why was this recommended to me", which is worth keeping — but
it is not sent to the model as preference signal. Once the user edits it, it
counts fully, like any other thing they typed.

This requires recording whether a note has been edited; the stored text alone
cannot tell the two apart.

## Alternatives considered

**Label the provenance in the prompt** ("recommended because …" rather than
"note: …") and let the model weight it accordingly. Rejected: this is a request
to the model, not a guarantee. Weighting instructions are followed
inconsistently, so the separation would be only as reliable as the model's
cooperation on a given day. The problem is structural and deserves a structural
fix.

**Never pre-fill the note.** Rejected: it removes the loop but also removes the
provenance information, which is useful to the user — particularly for a band
saved months earlier.

**Leave it as is** now that notes are becoming editable. Rejected: the majority
of notes will never be touched, so the majority of the corpus would keep feeding
the model its own text.

## Consequences

- A saved band the user never annotated contributes name, rating and categories
  to the context, but no note text. This is a deliberate reduction in signal:
  less input, but none of it circular.
- `SavedBand` gains a way to distinguish a user-authored note from a pre-filled
  one. The three repository adapters and the contract validator follow.
- The GDPR export keeps exporting the note either way — it is the user's data
  regardless of who first wrote it.
- The rule is testable at the seam that matters: the context builder either
  includes the text or it does not, and no test needs to reason about how a
  model weights a hint.

## Related

- `CONTEXT.md` — **Note**, **Category**, **Artist group**
- ADR 0001 — the other place where untrusted text reaches a prompt
