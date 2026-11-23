# ADR 0006 — Search jobs survive the client

**Status:** Accepted
**Date:** 2026-11-23 (#345)

## Context

A recommendation search takes 30–90 s on a cold or busy run (about 10 s on a
warm one). Until now `POST /recommendations` held one connection open for the
whole search, streamed `progress`, `reply` and `done` events over it, and
cancelled the search when the client closed the connection, so that a user who
stopped waiting did not use up searches.

On Android that is the wrong trade. The screen turns off after 30 s, Android
stops the app, the connection breaks, the server throws the work away, and the
user comes back to nothing. The same happens on a flaky mobile network. The
answer is lost exactly when the search was slow enough for the user to look
away.

## Decision

A search runs as a **search job** on the API, separate from the request that
started it. The owner approved the nine defaults recorded in #345.

1. **Shape.** `POST /recommendations/jobs` validates the question, starts the
   job and answers `202 { jobId }` at once. `GET /recommendations/jobs/:id`
   with `Accept: text/event-stream` streams the job's events (`AnswerEvent`,
   each with an `id:`), replaying what the client missed: everything after
   `Last-Event-ID` or `?after=`, or all of it. A finished job replays in full
   and ends. Without asking for a stream, the same `GET` returns where the job
   stands as JSON (`SearchJobState`), for a client that polls.
   `DELETE /recommendations/jobs/:id` stops it.
2. **Storage: memory.** No table. A finished job is kept for
   `SEARCH_JOB_KEEP_MINUTES` (60), then deleted by a timer, so an idle
   server keeps the privacy policy's promise too. Memory is bounded: at most 200
   jobs (the oldest finished go first when full; running ones are bounded by
   one per user; when all slots are running, another owner gets a retryable
   `503 search_capacity_exceeded`, while replacing your own search remains
   possible), at most 100 progress events per job, and a reply is kept as
   its latest text only (each reply carries the whole text so far).
3. **Cancel is explicit.** Stop is `DELETE`. A client hanging up stops
   following, never the search. A job nobody collects still ends: the
   pipeline's own budget (`RESEARCH_TIMEOUT_MS`, 180 s by default) ends the
   research, and a 5 minute backstop on the job fails one that is still running.
4. **Access.** The id is 128 random bits (`randomBytes(16)`, base64url), and
   every call also checks that the job belongs to the caller (`req.userId`; an
   install without accounts has one anonymous owner). Someone else's job
   answers exactly like a missing one: `404 search_job_not_found`, never 403.
   Job ids are cut to six characters in the request log.
5. **One running job per user.** Starting a search stops the same user's
   running one (it ends `cancelled`). Deleting the account stops and drops the
   user's jobs.
6. **The app keeps the job id** (with the question, mode and target) in local
   storage, every access guarded. At launch, when the app is shown again and on
   entering the chat it picks a kept search up: done shows the answer under its
   question, running shows its progress again, failed or unknown (404) shows an
   error with Retry. A connection that fails, ends early or goes quiet (no
   keep-alive for 45 s; the API sends one every 15 s) is re-attached after the
   last event seen, five times with growing waits (about 15 s), before the app
   says the connection dropped and keeps the job for later. The kept id is
   cleared once the answer or error was shown, or the user stopped the search.
7. **Desktop takes the same path**, local sidecar and hosted API alike. The
   client has no held-connection path any more.
8. **History is unchanged.** The answer goes into the chat on screen and is
   saved to the chat session as before.
9. **Rate limits.** Starting a job counts against the recommendations limit
   (30/min per client). Following, polling and stopping have their own limit of
   300/min per client: they are cheap and only reach the caller's own jobs.

`POST /recommendations` stays, as a thin wrapper over the same job: it starts
one and follows it to the end over the request, in JSON or as events, exactly
as before, except that hanging up no longer cancels. The eval runner and app
versions in the field use it. There is one pipeline invocation, one eval hook
(`evalWorker.processEvent` with the batch's `eventId`), one provenance block
and one error mapping, all in the job's work (`routes/recommendationRoutes.ts`);
the store (`searchJobs/searchJobs.ts`) knows nothing about recommendations.

## Consequences

- **A restart loses every job.** Render restarts on deploys and, rarely, on
  its own. A search running or finished but not yet collected at that moment
  is gone: the app gets 404 and says "This search was lost … Retry to ask
  again." This is the known gap of choosing memory. If it turns out to be
  frequent, the jobs move to Turso (see below).
- **One process.** Jobs live in the process that started them. Render's free
  plan runs one instance; a second instance would need sticky routing or a
  shared store.
- **Stopping costs a request.** A user who leaves without pressing Stop no
  longer cancels the search; it runs to its end. That is the point, and it
  costs at most one search per user, since a new search stops the previous one.
- **A search started from two devices of one account**: the newer stops the
  older, and the older device says its search was stopped.
- **Old app versions** keep working against the new API through
  `POST /recommendations`. Their Stop no longer stops the search on the server
  (it only drops the connection); a new search does.
- Results wait in memory for an hour. The privacy policy says so, and says the
  app keeps the question on the device while it waits.

## Alternatives considered

- **Held connection plus a wake lock** (keep the screen on, or a partial wake
  lock, while a search runs). Fights the platform instead of working with it:
  drains the battery, does nothing for a network change, a phone call or the
  user switching apps, and Android may still stop the app. It also leaves the
  server throwing away work whenever any connection breaks.
- **An Android foreground service** that holds the request. Needs native code
  in the Tauri app and a permanent notification for a 30-second wait, does
  nothing for a dropped network, and would be a second code path next to the
  desktop's.
- **Jobs stored in Turso.** Survives restarts and multiple instances, but adds
  a table, a migration, writes for every progress event (or a lossy subset),
  and cleanup, for a failure (a restart during a search) that is rare on the
  current deployment. The store sits behind a narrow interface
  (`start`, `get`, `follow`, `cancel`, `forgetOwner`, `evict`), so a persistent
  backend can replace it without touching routes or the app.
- **Polling only, no event stream.** Simpler server, but either slow to show
  progress or chatty, and the streamed reply (#257 step 6) would be lost.
- **Replacing `POST /recommendations` outright.** Would break the eval runner
  and every installed app at once; the wrapper costs a few lines and shares the
  whole pipeline path.
