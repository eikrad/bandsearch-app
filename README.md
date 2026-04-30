# Bandsearch

Bandsearch ist eine KI-gestuetzte Musikempfehlungs-App mit Fokus auf Nischenbands und weniger bekannte Artists.
Dieses Repository ist als Monorepo fuer den Tauri-Desktop-Client, die API und gemeinsame Schemas vorbereitet.

## Aktueller Status

- Phase 0 Foundation abgeschlossen: Repo-Struktur, CI-Baseline, Apache-2.0 Lizenz.
- Ziel fuer Phase 1: Recommendation-Core mit MusicBrainz + LangChain + Gemini.

## Monorepo-Struktur

- `apps/desktop` - Desktop App (Tauri + React, Platzhalter in Phase 0)
- `services/api` - Node.js/Express API (Platzhalter in Phase 0)
- `shared/schemas` - geteilte API- und Domain-Schemas
- `docs/ROADMAP.md` - Produkt- und Technik-Roadmap

## CI

Die CI laeuft ueber `.github/workflows/ci.yml` und fuehrt aktuell Lint, Typecheck und Tests ueber alle Workspaces aus.

## Lizenz

Dieses Projekt steht unter der Apache License 2.0. Siehe `LICENSE`.
