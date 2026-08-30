# Bandsearch UI Examples

## Purpose

This file provides practical examples that translate `UI_GUIDELINES.md` into implementation-ready patterns.

## Recommendation Card Example (Desktop)

### Do
- Title is the artist name and visually dominant.
- "Why selected" is concise and specific.
- Country/genres are short metadata lines.
- Connection text references prior bands in plain language.
- Rating stars and Save are always visible, on every screen size; Category/Note are compact actions.
- Tapping a star saves the band with that rating — rating implies saving.
- Saving does not imply rating: Save alone keeps a band unrated, which is a real state.
- Both are reversible on the card: the active star clears the rating, Saved removes the band.

Example content structure:

- Band: `Fen`
- Why selected: `Strong atmospheric overlap with your recent blackgaze picks.`
- Country/Genres: `UK · Post-black, atmospheric metal`
- Connected to: `Similar mood progression to Alcest and Agalloch.`
- Actions: `★★★☆☆` `Save` `···` `⎘`

### Don't
- Don't put country/genre above "why selected".
- Don't hide all actions behind menus on desktop.
- Don't hide Save or the rating stars on mobile — saving is the core loop, not a secondary action.
- Don't render a control that has no handler behind it.
- Don't write a rating the user did not pick — no silent defaults behind Save.
- Don't show long generic AI paragraphs as rationale text.

## Iconography Example

### Do
- Use a single icon family with consistent stroke style.
- Keep icon sizing on approved steps (e.g. 16/20/24).
- Pair unclear icons with text labels in action-heavy areas.

### Don't
- Don't mix outlined and filled icon sets without purpose.
- Don't use decorative icons where text hierarchy already communicates meaning.
- Don't rely on icon color alone to indicate status.

## Mode Accent Example

### Fresh mode
- Accent `#7aa7d9` on:
  - mode toggle active state (bg `#1c2d42`, text `#7aa7d9`)
  - card left border stripe (`#5b9bd5`)
  - submit button background
  - saved-badge text and selection indicators

### Preference-aware mode
- Accent `#d7a870` on the same roles (bg `#2d2318`, stripe `#c4944a`).
- No full-card color flood; keep editorial restraint.

## Chat Turn Example

### User turn
- User query bubble appears.

### Assistant loading
- Inline assistant loading row appears in timeline.

### Assistant result
- Recommendation cards render below assistant row.
- Meta label reflects mode used.
- Fallback indicator appears only when deterministic fallback is active.

## Error State Example

### Do
- Show inline message near failed assistant request.
- Include explicit retry action.
- Preserve prior successful recommendations in the timeline.

### Don't
- Don't replace the whole screen with blocking error modals.
- Don't lose user-entered query text on failure.

## AI Microcopy Example

### Good rationale style
- `Why selected: Atmospheric progression and guitar texture align with your Alcest and Fen preferences.`
- `Connected to: Similar mood arc to Agalloch, but with a cleaner post-black production profile.`

### Avoid
- `Why selected: This is a perfect match for your taste.`
- `Connected to: It is related to many bands.` (too vague)

## Empty State Example

### First-run chat empty state
- Headline: `Start with 1-3 bands you already like`
- Body: `We use those to generate niche recommendations with clear connection notes.`

### Preference-aware empty state
- Headline: `No saved preferences yet`
- Body: `Save or rate a few artists to improve preference-aware recommendations.`

## Desktop-first to Mobile-next Mapping

### Desktop MVP
- Inline card actions visible where practical.
- Multi-column breathing room if layout supports it.

### Mobile (Phase 7, Android)
- Keep field order unchanged.
- Collapse **only** Category, Note and Copy into a compact sheet/menu. Rating stars and Save stay inline.
- Every interactive control is at least 44 × 44 px.
- Preserve readability first; let the action row wrap rather than shrinking targets.
