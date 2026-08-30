# Bandsearch UI Guidelines

## Purpose

This document defines practical UI guardrails for Bandsearch so the product feels intentional, editorial, and non-generic while remaining fast to build.

Scope:
- Desktop-first MVP
- Chat-first recommendation experience
- Shared standards for future mobile adaptation

## Design Direction

### Brand posture
- Editorial
- Curated
- Precise
- Atmospheric

### Anti-patterns to avoid
- Generic neon gradients and "AI dashboard" styling
- Heavy glassmorphism as a default visual language
- Oversized playful controls that reduce readability
- Over-decorated cards that hide recommendation content hierarchy

## Core Visual System

### Color tokens (locked)

| Token | Value | Role |
|-------|-------|------|
| `pageBg` | `#0d0f14` | Page/shell background |
| `cardBg` | `#111827` | Card and input surfaces |
| `border` | `#1e2a3a` | Borders and dividers |
| `textPrimary` | `#f0f4f8` | Band name, body text |
| `textSecondary` | `#8896a8` | Meta, country, connection text |
| `textTertiary` | `#5a6880` | Labels, chips, helper text |
| `buttonBg` | `#161e2e` | Secondary button fill |
| `buttonBorder` | `#243044` | Secondary button border |
| `buttonText` | `#c8d4e8` | Secondary button label |
| `inputBg` | `#0b0e18` | Query input background |
| `inputBorder` | `#1e2a3a` | Query input border (idle) |

**Fresh mode accent tokens:**

| Token | Value |
|-------|-------|
| `accent` | `#7aa7d9` |
| `accentDim` | `#1c2d42` |
| `accentStripe` | `#5b9bd5` |

**Preference-aware mode accent tokens:**

| Token | Value |
|-------|-------|
| `accent` | `#d7a870` |
| `accentDim` | `#2d2318` |
| `accentStripe` | `#c4944a` |

### Accent usage rules (medium intensity)
- Always on active mode toggle.
- On active controls (selected tabs/buttons/actions).
- On subtle section separators and small emphasis elements.
- Never as full-screen or full-card fill for standard content states.

## Iconography

### MVP approach (locked)
- No external icon library in desktop MVP: use text labels for all primary actions ("Save", "Rate", "···" for overflow).
- Unicode symbols (`⎘`, `✓`, `○`, `×`) may be used only for supplementary controls (copy, tick/untick, delete) that have a `title` tooltip fallback.
- Do not use color alone to indicate icon meaning.

### Icon family for future phases
- If a dedicated icon library is added post-MVP, use one family with consistent outline stroke style across the product (no mixing).
- Fixed size scale: 16 / 20 / 24 px — no arbitrary per-component sizing.
- Keep icon density low: readability over decoration.

## Typography

### Type scale (locked)

| Role | Size | Weight | Style | Color token |
|------|------|--------|-------|-------------|
| Page title (h1) | 15px | 700 | normal | `textPrimary` |
| Section headings | 15px | 700 | normal | `textPrimary` |
| Band name (h2) | 15px | 600, `-0.01em` tracking | normal | `textPrimary` |
| Why selected | 13px | 400 | italic, 1.5 line-height | `textPrimary` |
| Meta (country, genres) | 13px | 400 | normal | `textSecondary` |
| Connection text | 13px | 400 | italic | `textSecondary` |
| Body / assistant prose | 14px | 400 | normal, 1.45 line-height | `textPrimary` |
| Action buttons | 13px | 400 | normal | `buttonText` |
| Genre chips / badges | 11px | 400 | uppercase, 0.04em tracking | `textTertiary` |
| Section rail labels | 11px | 600 | uppercase, 0.06em tracking | `textTertiary` |
| Helper / hint text | 12px | 400 | normal | `textTertiary` |

Base font stack: `Inter, "Segoe UI", Roboto, Arial, sans-serif` at 15px / 1.5 line-height.

### Readability rules
- Keep recommendation rationale concise and scannable.
- Avoid long dense paragraphs in cards.
- Preserve clear line-height differences between hierarchy levels.

## Spacing and Layout Rhythm

### Spacing scale (locked, 4/8-based)

| Step | Value | Typical use |
|------|-------|-------------|
| xs | 4px | Tight chip/badge padding, icon nudges |
| sm | 8px | Card internal gap, button gap in rows |
| md | 10px | Card padding, section internal gap |
| lg | 12px | Card internal grid gap, composer margin |
| xl | 16px | Composer padding-top, header divider margin |
| 2xl | 20px | Desktop rail gap |
| 3xl | 24px | Header margin-bottom, page section separation |
| 4xl | 32px | Page horizontal padding (desktop) |

### Layout (locked)
- Single-column content max-width: **760px**, centered.
- Desktop split layout (chat + results rail): `grid-template-columns: minmax(0, 1fr) minmax(280px, 340px)`, gap 20px. Combined max-width: `min(1120px, 100%)`.
- Page horizontal padding: 32px desktop / 16px mobile.
- Maintain clear vertical separation between chat turns (grid gap: 16px in message thread).
- Recommendation card gap: 10px between cards in grid.

## Recommendation Card Anatomy (Locked)

Each recommendation tile renders fields in this exact order:

1. Band name (h2, 15px/600, accent left stripe on card border)
2. Saved badge (11px chip, inline with title, visible only when saved)
3. Why selected (13px italic, `textPrimary`)
4. Country + genres as a single meta line (`country · genre1, genre2`, 13px `textSecondary`)
5. Genre chips row (11px uppercase chips, same genre data, visual emphasis)
6. Platform links (11px chips, e.g. Bandcamp, Spotify — only when present)
7. Connection text (13px italic `textSecondary`, separated by top border)
8. Action row

Card visual spec:
- Background: `cardBg` (`#111827`)
- Border: 1px `border` (`#1e2a3a`) + 3px left `accentStripe` (mode-dependent)
- Border radius: 8px
- Padding: 10px

Action row policy (locked, all viewports):

| Control | Visibility | Behaviour |
|---|---|---|
| Rating stars (1–5) | Always | Tapping star *n* saves the band **with rating *n***. Rating implies saving. |
| Save | Always | Saves without a rating, for "remember this, undecided". |
| `···` overflow | Always | Category / Note. Must open something — see the rule below. |
| Copy `⎘` | Always, row end | Icon-only, `title="Copy"` tooltip. |

- **Save and the stars are primary and never collapse**, on any screen size.
  Saving is what makes `preference-aware` mode work, so it is the one action
  that must always be one tap away. Only Category/Note and Copy are secondary.
- **Rating implies saving.** There is no state where a band is rated but not
  saved. A separate "Rate" text button is not used — it cannot express *which*
  rating is being given, which is why the previous one silently always wrote 5.
- **No control may render without an action behind it.** If Category/Note is not
  implemented, the `···` button is not rendered at all. A visible control that
  does nothing on click is a defect, not a placeholder.

## Connecting State (locked)

Shown at startup while the API is being polled, and when polling gives up. It
exists because an unreachable API was previously indistinguishable from "auth is
switched off", which dropped the user into an app whose every request then
failed.

| State | Heading | Controls |
|---|---|---|
| `waiting` | "Starting the server" | **None.** A manual retry is meaningless while an automatic one is running. |
| `waiting`, 4+ attempts | "Still starting…" | None. The copy must change, so a long wait cannot be mistaken for a hang. |
| `failed` | "Could not reach the server" | "Try again" button, min 44px tall. |

- **Never show a bare spinner here.** A spinner looks identical at second 1 and
  second 60; a hosted instance that has spun down takes 30–60s to wake, so the
  screen must say what is happening and acknowledge a long wait.
- **Only reached when the first status check fails.** A healthy API routes
  straight to its destination — no detour, no flash of this screen.
- The `failed` copy points at Settings, since a wrong API endpoint produces the
  same symptom as an unreachable one.

## Interaction and State Design

### Chat and request states
- Show a clear loading state in the assistant flow while fetching recommendations.
- Show inline recoverable errors with retry.
- Keep state feedback local to the interaction context (not global alerts by default).

### Recommendation quality states
- If deterministic fallback is used, show a small fallback indicator.
- Preserve trust by always showing "why selected" and connection text.

### Persistence actions
- Save/Rate should provide immediate visual confirmation.
- Category/Note interactions should not block the main flow.

### Component state matrix (locked baseline)
- Recommendation card: default, hover (`.action-btn:hover` via CSS), loading, fallback.
- Primary actions: default, hover (`filter: brightness(1.1)`), disabled (`opacity: 0.45`, `cursor: not-allowed`), active.
- Secondary action buttons: default, hover (`background: #2d374f`, `border-color: #3a4a63`), focus-visible (2px `#7aa7d9` outline, 2px offset).
- Mode toggle: default (transparent/`#6b7a90`), active-fresh (`#1c2d42` bg / `#7aa7d9` text), active-warm (`#2d2318` bg / `#d7a870` text), hover (inactive: `#aeb8cc` text).
- Input area: idle, focus (`border-color: #3a5070`, `box-shadow: 0 0 0 2px rgba(90,150,210,0.12)`), submitting (disabled).
- Loading indicator: 18px spinner, 2px border, `border-top-color` = current accent, 0.75s linear spin.

## Obscurity Target Picker

Three-button segmented selector (cult / underground / obscure). Shares the same visual language as the mode pill:

- Container: `display: inline-flex`, `gap: 4px`
- Inactive button: transparent bg, `#6b7a90` text, no border
- Active button: `accentDim` bg, `accent` text, no border
- Button shape: `border-radius: 6px`, `padding: 5px 12px`, `font-size: 12px`
- Deselect by clicking the active button again (toggle-off)

CSS must be defined in `styles.css` under `.obscurity-target-picker` and `.obscurity-target-picker button.active`.

## Mode Behavior

### Fresh mode
- Uses current query context only.
- UI accent uses cool neutral profile.

### Preference-aware mode
- Uses saved profile context (ratings/categories/notes).
- UI accent uses muted warm profile.

## Accessibility Baseline

- Full keyboard navigation for chat and card actions.
- Visible focus states on interactive controls.
- Strong contrast for body/meta text against dark backgrounds.
- Touch/click targets sized for reliable interaction.

## AI Microcopy and Content Rules (Recommended)

- Keep "why selected" concise (prefer 1-2 short sentences).
- Keep connection text explicit and user-relevant (reference prior bands by name).
- Avoid generic claims ("best match", "perfect choice") without concrete rationale.
- If deterministic fallback is used, label it clearly but calmly.
- Keep microcopy consistent across cards: same tone and sentence structure.

## Empty, Error, and Feedback Patterns (Recommended)

### Empty states
- First-use state: prompt user to enter favorite bands.
- No saved preferences state: explain that preference-aware mode improves after saving bands.

### Error states
- Show request errors inline in chat context.
- Provide a clear retry action near the failed interaction.

### Feedback states
- Use local confirmations for Save/Rate actions.
- Avoid disruptive global notifications for routine success events.

## Responsiveness Policy

Mobile is a first-class target as of Phase 7 (Android), not a later adaptation.

### Locked values

| Rule | Value |
|---|---|
| Mobile breakpoint | `max-width: 767px` |
| Minimum touch target | **44 × 44 px** for every interactive control on mobile |
| Page horizontal padding | 32px desktop / 16px mobile |
| Card action row | wraps on mobile (`flex-wrap: wrap`), never scrolls horizontally |

### What may and may not collapse

- **Never collapsed, any viewport:** rating stars, Save, the query input, the
  mode toggle, primary navigation.
- **May collapse into the `···` overflow on mobile:** Category, Note, Copy.

"Non-primary" previously appeared here without a definition, and was read as
including Save and Rate — which the Recommendation Card section lists as always
visible. The two lists above replace that ambiguity; when adding a control,
place it in one of them.

### Views

Every view must be usable at 360px width, not only `ChatAppView`. The
onboarding path a new mobile user hits first — Welcome → Register/Login →
Settings → Chat → Saved Artists — is part of this requirement, not a follow-up.

## Roadmap UI Ideas

- Artist relationship graph (node view) for collection exploration.
- Advanced visual analytics of saved artist clusters and connection paths.

This remains explicitly post-MVP and must not delay the core recommendation workflow.
