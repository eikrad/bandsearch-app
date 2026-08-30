# Data flow and EU residency — status as of 2026-08-30

Written while planning Phase 7 (Android). No decision is recorded here and
nothing was changed; this is the factual picture so the decision can be made
later without re-deriving it.

The question that prompted it: *"is any of this hosted in the EU?"* The answer
turns out to depend on which of two different goals is meant — **EU data
residency** (where the bytes sit) or **EU sovereignty** (whose jurisdiction the
provider answers to). They have very different costs.

## Where data actually goes

| Layer | Location | Provider | What reaches it |
|---|---|---|---|
| Compute | Frankfurt ✅ | 🇺🇸 Render Inc. | — |
| Database | EU selectable | 🇺🇸 Turso | accounts, e-mail addresses, password hashes, saved preferences, chat history |
| LLM | US | 🇺🇸 Google (Gemini) | **query text + full conversation context** |
| Web search | US | 🇺🇸 Brave | **search queries, retained 90 days** |
| Judge (optional) | US | 🇺🇸 Anthropic | recommendation prose |

The compute layer — the only one a hosting migration would move — is the one
carrying the least personal data. The user's actual queries and conversation go
to Google and Brave regardless of where the Express process runs. That is
architectural, not a hosting choice.

## What is already EU

- `render.yaml` sets `region: frankfurt`, so compute already runs in the EU.
- Turso offers EU locations (Frankfurt, Amsterdam, Paris, Dublin, Stockholm,
  Brussels). Which one is used is fixed when the database is created, via the
  dashboard — `TURSO_DATABASE_URL` is a secret, so the choice is not visible in
  this repo.

## What the privacy policy already says

`apps/desktop/src/ui/privacyPolicyText.ts` discloses the two third-country
transfers that matter, and they are covered:

- Google LLC is certified under the EU–US Data Privacy Framework, with Standard
  Contractual Clauses as fallback.
- Brave receives search queries and retains them up to 90 days for billing and
  troubleshooting.

So the transfers are disclosed and safeguarded. This note does not change that
assessment.

## Open items (not decided)

1. **Turso region must be chosen deliberately** when the production database is
   created — part of Phase 9.5, which has never been run. Turso also replicates
   across 35+ locations; that is a feature until a regulator asks where personal
   data physically lives, so replication scope should be set consciously rather
   than left at whatever the default is.
2. **A US provider with an EU datacenter gives residency, not sovereignty.**
   Render and Turso are both US-incorporated. Frankfurt hosting does not remove
   CLOUD Act reach over the parent company.

## EU alternatives, if sovereignty ever becomes the goal

Recorded so the option is not re-researched from scratch. Not recommended and
not scoped — replacing the search and LLM providers means rebuilding the
research pipeline, since prompt formats, structured outputs and snippet parsing
are all shaped by the current two.

- **Hosting:** Hetzner (DE, ~4 €/month), Scaleway (FR), OVHcloud (FR), IONOS (DE)
- **LLM:** Mistral (FR) — note the codebase already has a `MISTRAL_API_KEY`
  env var, which per Phase 8 Step 5 actually points at Anthropic. The name is a
  known mismatch, but the EU-provider shape is already there.
- **Web search:** Qwant (FR) is the closest equivalent to Brave with an API.

## Bearing on Phase 7 (Android)

Android cannot run the Node sidecar (Tauri's shell plugin is restricted to
opening URLs on mobile), so an Android build is hard-dependent on the hosted
API. Whatever is decided about hosting therefore constrains Android directly —
which is why this note exists.
