# ADR 0005 — Closed beta via email-bound invites and an enforced auth mode

**Status:** Accepted
**Date:** 2026-10-08 (#266)

## Context

The hosted API (Render) is reachable by anyone who has its URL, and two
properties of progressive auth make that worse than it sounds:

- At **0 users** the middleware passes every request through, and
  `POST /auth/register` is open, so the first stranger to arrive owns the
  deployment.
- At **1 user** the middleware attaches every unauthenticated request, and
  every request with an invalid token, to that user. A scanner reading
  `/preferences` reads the owner's saved bands.

Progressive auth is the right default for a personal install, which is why it
stays the default. A closed beta needs the opposite: a known set of testers and
nobody else.

Not in scope: an admin UI, an `is_admin` flag, sending or verifying email, a
waitlist.

## Decision

1. **`AUTH_MODE=progressive|enforced`**, default `progressive` (unchanged).
   An unknown value is a startup error, not a silent fallback to open.
2. **Enforced mode** drops every bypass: a valid token is always required; the
   middleware checks on each request that the token's user still exists and is
   not disabled; `JWT_SECRET` is required (without it the server refuses to
   start, since a random per-boot secret would log everyone out on every
   restart); `createApp` also throws if enforced without a secret, so a
   mis-wired app cannot come up open; `/artists/*` goes behind auth because it
   spends the operator's MusicBrainz, Wikidata and Last.fm quotas.
3. **Invites** live in their own table. An invite is bound to one email
   address, stored normalized, single use, 14 days by default. The code is 128
   random bits (eight groups of four hex digits); only its SHA-256 hash is
   stored, and lookup is by that hash. A fast hash is enough because the input
   is 128 bits of randomness, not a human-chosen secret.
4. **Registration in enforced mode requires `inviteCode`.** A missing, malformed,
   unknown, expired, used, revoked or wrong-address code yields the identical
   `403 invite_invalid` response, so the endpoint does not reveal which
   invites exist. `GET /auth/status` reports `authMode` and `inviteRequired`
   for clients.
5. **Single use without a cross-repository transaction.** The flow is: look the
   invite up (read), create the user, mark the invite used. `users.email` is
   `UNIQUE` and the invite is bound to that one address, so two concurrent
   registrations with the same code both try to create the same address and
   exactly one succeeds. A crash after the user is created and before the
   invite is marked leaves a spent-in-fact invite for an address that already
   has an account, which is harmless. A failed registration (bad input,
   duplicate address) never reaches the "mark used" step, so it does not burn
   the invite. `markUsed` is additionally a conditional update, so only one
   caller can win it.
6. **Disabling** is a nullable `users.disabled_at`. It is checked at login and
   on every enforced request, so it takes effect at once rather than when a
   30-day token runs out.
7. **Administration is database access.** `invite:create|list|revoke` and
   `user:disable|enable` are CLI scripts that use the same repository adapters
   as the server. There are no admin HTTP endpoints: nothing to authenticate,
   rate-limit or misconfigure, and the people who can run them are exactly
   the people who can already read the database.
8. **Rate limiting on `/auth/register`, `/auth/login`, `/auth/reset-password`:**
   20 requests per 15 minutes per client IP. For this to key on the client and
   not on Render's proxy, the app sets `trust proxy` to 1 (this also repaired
   the existing `/recommendations` limit, which had been one shared bucket for
   all users behind the proxy).
9. `REGISTRATION_OPEN=false` is unchanged: a hard stop on `POST /auth/register`
   in either mode, invites included.

## What this does not do

**The email address is not verified.** Nothing proves the person registering
controls the address on the invite. The security rests on the code being secret
and unguessable. Binding it to an address gives two narrower guarantees: the
account carries the address the operator invited, and a code forwarded to or
intercepted by someone else does not work for any address but the invited one.
Someone who obtains both the code and the address can register. For a closed
beta of people the operator knows, that is the accepted risk; verification would
need email sending, which is out of scope.

Other limits worth knowing:

- Disabling a user does not delete their data and does not stop a request that
  is already in flight.
- The rate limit is in memory and per process. Restarting the service resets
  it, and a second instance would have its own counters. Render's free tier
  runs one.
- `trust proxy` is a hard `1`. Behind a different number of proxies (or none,
  with a client able to send `X-Forwarded-For`) the limit could be keyed on a
  spoofable address. It matches Render and is harmless locally.
- Existing sessions of users who registered before enforced mode keep working
  (their users exist), which is intended.

## Consequences

- A fresh enforced deployment has no way in over HTTP. The operator runs
  `migrate:turso` (migration `005`), then `invite:create` for themselves.
- Lost codes cannot be recovered, only revoked and reissued.
- SQLite databases from before this change gain `users.disabled_at` and the
  `invites` table when the adapters start; Turso needs migration `005`.
- Moving to an admin UI later means adding an `is_admin` flag and endpoints on
  top of the same repositories and `inviteService`; nothing here blocks it.

## Alternatives considered

- **Shared beta password / a single registration key.** One leak opens the door
  for everyone, and cannot be revoked per person.
- **Invites stored in the `users` table.** Mixes a person who does not exist yet
  with one who does, and makes "list pending invites" a filter on a table the
  auth hot path reads.
- **Not binding the code to an email.** Simpler, but a forwarded code works for
  anyone, and the operator cannot tell who an account is.
- **Admin endpoints guarded by an `is_admin` flag.** More surface to secure for
  a beta with one operator.
- **Short, human-friendly codes with a slow hash.** Would make codes guessable
  or require a bcrypt call per lookup; 128 bits makes both unnecessary.
