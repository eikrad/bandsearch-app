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

### Color model
- Base: dark neutral surfaces and text hierarchy focused on readability.
- Accent: mode-adaptive at medium intensity.
  - `fresh` mode: cool neutral accent.
  - `preference-aware` mode: muted warm accent.

### Accent usage rules (medium intensity)
- Always on active mode toggle.
- On active controls (selected tabs/buttons/actions).
- On subtle section separators and small emphasis elements.
- Never as full-screen or full-card fill for standard content states.

## Typography

### Hierarchy intent
1. Band name (primary)
2. Why selected (secondary narrative)
3. Metadata (country, genres, connection text)
4. Utility labels/chips/meta badges

### Readability rules
- Keep recommendation rationale concise and scannable.
- Avoid long dense paragraphs in cards.
- Preserve clear line-height differences between hierarchy levels.

## Spacing and Layout Rhythm

- Use a consistent spacing scale (4/8-based rhythm).
- Maintain clear vertical separation between chat turns.
- Keep recommendation cards compact but breathable.
- Prioritize text clarity over decorative density.

## Recommendation Card Anatomy (Locked Order)

Each recommendation tile should render fields in this order:

1. Band name
2. Why selected
3. Country + genres
4. Connection to previously discussed bands (plain text sentence)
5. Action row

Action row policy (desktop MVP):
- Always visible: Save, Rate
- Compact menu: Category, Note

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

## Responsiveness Policy

- MVP target: desktop-first.
- Mobile adaptation is next step, not blocked in MVP.
- For mobile, move non-primary actions behind compact affordances.

## Roadmap UI Ideas

- Artist relationship graph (node view) for collection exploration.
- Advanced visual analytics of saved artist clusters and connection paths.

This remains explicitly post-MVP and must not delay the core recommendation workflow.
