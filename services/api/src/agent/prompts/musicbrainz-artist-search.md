# MusicBrainz artist search (Bandsearch)

Bandsearch calls **`GET /ws/2/artist?query=…&fmt=json&limit=5`** on [musicbrainz.org](https://musicbrainz.org). The `query` parameter is a **Lucene** text query against the **artist** index only (not recordings, releases, or works).

## Default behaviour

If you **do not** prefix a field name, terms are matched against **`alias`**, **`artist`** (name), and **`sortname`** (diacritics often normalized for `alias` / `artist`).

## Useful indexed fields (artist)

You may use `field:value` when it tightens results (see [MusicBrainz API Search — Artist](https://musicbrainz.org/doc/MusicBrainz_API/Search#Artist)):

| Field | Meaning (short) |
|-------|-----------------|
| `artist` | Artist name (diacritics-insensitive match) |
| `artistaccent` | Name with diacritics as given |
| `alias` | Any alias |
| `sortname` | Sort name |
| `comment` | Disambiguation comment text |
| `country` | ISO 3166-1 alpha-2 country code |
| `area` | Associated area name (partial) |
| `tag` | User/community tags on the artist |
| `type` | e.g. `person`, `group` |
| `arid` | Artist MBID (UUID) when known |
| `begin` / `end` | Begin or end date (YYYY-MM-DD style) |

## Lucene tips (keep queries short)

- Quote exact phrases: `"iron maiden"`.
- Combine with **AND** / **OR** when needed.
- Avoid long natural-language sentences; prefer **names + a few disambiguators** (country, tag, year).

## Limits

- MusicBrainz is **not** semantic audio search; vague vibe words alone may miss. Pair with **artist names** from the user or thread when possible.
- Bandsearch uses **`limit=5`**; aim for a query that surfaces the most relevant entities in the first hits.
