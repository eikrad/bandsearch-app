# Bandsearch

Bandsearch ist eine KI-gestuetzte Musikempfehlungs-App mit Fokus auf Nischenbands und weniger bekannte Artists.
Dieses Repository ist als Monorepo fuer den Tauri-Desktop-Client, die API und gemeinsame Schemas vorbereitet.

## Aktueller Status

- Phase 0 Foundation abgeschlossen: Repo-Struktur, CI-Baseline, Apache-2.0 Lizenz.
- Ziel fuer Phase 1: Recommendation-Core mit MusicBrainz + LangChain + Gemini.

## Monorepo-Struktur

- `apps/desktop` - Desktop App (Tauri + React, Platzhalter in Phase 0)
- `services/api` - Node.js/Express API
- `shared/schemas` - geteilte API- und Domain-Schemas
- `docs/ROADMAP.md` - Produkt- und Technik-Roadmap

## Lokaler Start (API)

```bash
npm install
node services/api/src/server.js
```

Standard-Port: `3001` (ueber `PORT` anpassbar).

## API Referenz (aktueller Stand)

### System

- `GET /health`
  - Zweck: einfacher Liveness-Check (`{ "status": "ok" }`)

- `GET /version`
  - Zweck: liefert die aktuelle App-Version aus `package.json`

### Recommendations

- `POST /recommendations`
  - Zweck: liefert Band-Empfehlungen
  - Body:
    - `query` (string, required)
    - `mode` (`fresh` oder `preference-aware`, optional; default `fresh`)
  - Response:
    - `recommendations[]` mit `artist`, `why`, `sourceSignals[]`
    - `meta.modeUsed`
    - `meta.usedPreferenceContext`

Beispiel:

```json
{
  "query": "I like Alcest and Agalloch",
  "mode": "preference-aware"
}
```

### Preferences (Saved Bands)

- `POST /preferences`
  - Zweck: speichert eine Band-Praeferenz
  - Body:
    - `musicbrainzArtistId` (string)
    - `name` (string)
    - `rating` (int 1-5)
    - `categories` (string[])
    - `note` (string)

- `GET /preferences`
  - Zweck: listet alle gespeicherten Bands

- `PATCH /preferences/:id`
  - Zweck: aktualisiert `rating`, `categories`, `note`

- `DELETE /preferences/:id`
  - Zweck: loescht einen gespeicherten Eintrag

- `GET /preferences/context`
  - Zweck: liefert verdichteten Preference-Kontext fuer `preference-aware` Suche

## Shared Contracts

- Gemeinsame Validierungs-Contracts liegen in `shared/schemas/src/contracts.js`.
- Aktuell zentralisiert:
  - Recommendation-Item-Validierung
  - Saved-Band-Validierung
  - Recommendation-Mode-Normalisierung (`fresh` / `preference-aware`)
- API und Tests nutzen diese Contracts bereits, damit Backend und spaeter Frontend denselben Datenvertrag teilen.

## CI

Die CI laeuft ueber `.github/workflows/ci.yml` und fuehrt aktuell Lint, Typecheck und Tests ueber alle Workspaces aus.

## Lizenz

Dieses Projekt steht unter der Apache License 2.0. Siehe `LICENSE`.
