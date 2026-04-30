# Bandsearch UI Examples

## Purpose

This file provides practical examples that translate `UI_GUIDELINES.md` into implementation-ready patterns.

## Recommendation Card Example (Desktop)

### Do
- Title is the artist name and visually dominant.
- "Why selected" is concise and specific.
- Country/genres are short metadata lines.
- Connection text references prior bands in plain language.
- Save/Rate are always visible; Category/Note are compact actions.

Example content structure:

- Band: `Fen`
- Why selected: `Strong atmospheric overlap with your recent blackgaze picks.`
- Country/Genres: `UK · Post-black, atmospheric metal`
- Connected to: `Similar mood progression to Alcest and Agalloch.`
- Actions: `Save` `Rate` `More`

### Don't
- Don't put country/genre above "why selected".
- Don't hide all actions behind menus on desktop.
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
- Cool neutral accent on:
  - mode toggle active state
  - active action highlights
  - thin separators

### Preference-aware mode
- Muted warm accent on the same roles.
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

### Mobile next step
- Keep field order unchanged.
- Collapse secondary actions into compact sheet/menu.
- Preserve readability first; avoid dense control rows.
