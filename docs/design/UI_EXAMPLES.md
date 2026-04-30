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

## Desktop-first to Mobile-next Mapping

### Desktop MVP
- Inline card actions visible where practical.
- Multi-column breathing room if layout supports it.

### Mobile next step
- Keep field order unchanged.
- Collapse secondary actions into compact sheet/menu.
- Preserve readability first; avoid dense control rows.
