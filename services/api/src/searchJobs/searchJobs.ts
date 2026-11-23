import { randomBytes } from "node:crypto";

import {
  SEARCH_JOB_KEEP_MINUTES,
  type AnswerEvent,
  type AnswerProgress,
  type SearchJobStatus,
} from "../../../../shared/schemas/src/contracts.js";

/** One event of a job, numbered so a follower can resume after the last one it saw. */
export type SearchJobEvent = { id: number; event: AnswerEvent };

/** What the work may report while it runs; how it ends is up to the store. */
export type SearchJobProgressEvent = Extract<AnswerEvent, { type: "progress" | "reply" }>;

/** The public error a failed job ends with; the same shape a failed request has. */
export type SearchJobFailure = { status: number; code: string; message: string };

/** The search itself: reports progress, honours the signal, resolves to the response. */
export type SearchJobWork = (job: { emit(event: SearchJobProgressEvent): void; signal: AbortSignal }) => Promise<unknown>;

/** Where a job stands, for a client that polls. */
export type SearchJobSnapshot = {
  status: SearchJobStatus;
  progress: AnswerProgress | null;
  reply: string;
  response?: unknown;
  error?: SearchJobFailure;
};

export type SearchJobs = {
  /** Runs `work` as a new job of `owner`, stopping that owner's running job. Returns the job id. */
  start(owner: string, work: SearchJobWork): string;
  /** Where the job stands; undefined when it does not exist or belongs to someone else. */
  get(id: string, owner: string): SearchJobSnapshot | undefined;
  /**
   * Replays the job's events after `after`, then passes on new ones until its
   * end (`done`, `error` or `cancelled`), which comes last. Returns the
   * unfollow, or undefined when the job does not exist or is someone else's.
   * Unfollowing never stops the job.
   */
  follow(id: string, owner: string, after: number, listener: (event: SearchJobEvent) => void): (() => void) | undefined;
  /** Stops the job; false when it does not exist or is someone else's. A finished job stays as it ended. */
  cancel(id: string, owner: string): boolean;
  /** Stops and drops every job of `owner`, when their account is deleted. */
  forgetOwner(owner: string): void;
  /** Drops finished jobs kept longer than the keep time. Every other call does this first. */
  evict(): void;
};

export type SearchJobsOptions = {
  /** The public error for whatever the work threw (and the place to log it). */
  describeFailure: (error: unknown) => SearchJobFailure;
  now?: () => number;
  /** Runs `run` after `ms`; returns a cancel. */
  schedule?: (run: () => void, ms: number) => () => void;
  /** How long a finished job is kept for its owner to collect. */
  keepFinishedMs?: number;
  /**
   * A backstop above the pipeline's own budget (RESEARCH_TIMEOUT_MS, 180 s by
   * default, plus routing and the answer): a job still running then fails.
   */
  maxRunMs?: number;
  /** Jobs kept at most; when full the oldest finished ones go. Running ones are bounded by one per user. */
  maxJobs?: number;
  /** Progress events kept per job; the reply is kept as its latest text only, and the end always. */
  maxEventsPerJob?: number;
};

type Job = {
  id: string;
  owner: string;
  status: SearchJobStatus;
  events: SearchJobEvent[];
  nextEventId: number;
  followers: Set<(event: SearchJobEvent) => void>;
  progress: AnswerProgress | null;
  reply: string;
  response?: unknown;
  error?: SearchJobFailure;
  finishedAt: number | null;
  controller: AbortController;
  clearDeadline: () => void;
};

function defaultSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  // A pending deadline must not keep the process (or a test run) alive.
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** 128 random bits, URL-safe: the id is unguessable, and ownership is checked as well. */
function newJobId(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Search jobs in memory: a search runs to its end whether or not anyone is
 * listening, and its owner can follow it, leave, and come back (ADR 0006).
 * A restart loses them all.
 */
export function createSearchJobs({
  describeFailure,
  now = Date.now,
  schedule = defaultSchedule,
  keepFinishedMs = SEARCH_JOB_KEEP_MINUTES * 60 * 1000,
  maxRunMs = 5 * 60 * 1000,
  maxJobs = 200,
  maxEventsPerJob = 100,
}: SearchJobsOptions): SearchJobs {
  const jobs = new Map<string, Job>();

  function evict() {
    for (const [id, job] of jobs) {
      if (job.finishedAt !== null && now() - job.finishedAt >= keepFinishedMs) jobs.delete(id);
    }
  }

  function makeRoom() {
    if (jobs.size <= maxJobs) return;
    const finished = [...jobs.values()]
      .filter((job) => job.finishedAt !== null)
      .sort((a, b) => a.finishedAt! - b.finishedAt!);
    for (const job of finished) {
      if (jobs.size <= maxJobs) break;
      jobs.delete(job.id);
    }
  }

  function owned(id: string, owner: string): Job | undefined {
    evict();
    const job = jobs.get(id);
    return job && job.owner === owner ? job : undefined;
  }

  function record(job: Job, event: AnswerEvent) {
    const entry = { id: job.nextEventId++, event };
    const last = job.events.at(-1);
    // A reply carries the whole text so far: only the newest is worth keeping.
    if (event.type === "reply" && last?.event.type === "reply") job.events[job.events.length - 1] = entry;
    else if (job.events.length < maxEventsPerJob || job.status !== "running") job.events.push(entry);
    for (const follower of job.followers) follower(entry);
  }

  function emit(job: Job, event: SearchJobProgressEvent) {
    if (job.status !== "running") return;
    if (event.type === "progress") {
      job.progress = event.progress;
      // Each stage starts its own reply.
      job.reply = "";
    } else {
      job.reply = event.text;
    }
    record(job, event);
  }

  function end(job: Job, status: Exclude<SearchJobStatus, "running">, event: AnswerEvent) {
    if (job.status !== "running") return;
    job.status = status;
    job.finishedAt = now();
    job.clearDeadline();
    record(job, event);
    job.followers.clear();
  }

  function succeed(job: Job, response: unknown) {
    if (job.status !== "running") return;
    job.response = response;
    end(job, "done", { type: "done", response });
  }

  function fail(job: Job, error: unknown) {
    if (job.status !== "running") return;
    const failure = describeFailure(error);
    job.error = failure;
    end(job, "failed", { type: "error", status: failure.status, error: { code: failure.code, message: failure.message } });
  }

  function stop(job: Job) {
    if (job.status !== "running") return;
    end(job, "cancelled", { type: "cancelled" });
    job.controller.abort(new Error("the search was stopped"));
  }

  return {
    start(owner, work) {
      evict();
      for (const job of jobs.values()) if (job.owner === owner) stop(job);

      const job: Job = {
        id: newJobId(),
        owner,
        status: "running",
        events: [],
        nextEventId: 1,
        followers: new Set(),
        progress: null,
        reply: "",
        finishedAt: null,
        controller: new AbortController(),
        clearDeadline: () => {},
      };
      jobs.set(job.id, job);
      makeRoom();
      job.clearDeadline = schedule(() => {
        const timeout = new Error("the search job ran past its deadline");
        fail(job, timeout);
        job.controller.abort(timeout);
      }, maxRunMs);

      let running: Promise<unknown>;
      try {
        running = work({ emit: (event) => emit(job, event), signal: job.controller.signal });
      } catch (error) {
        running = Promise.reject(error);
      }
      running.then((response) => succeed(job, response), (error: unknown) => fail(job, error));
      return job.id;
    },

    get(id, owner) {
      const job = owned(id, owner);
      if (!job) return undefined;
      return {
        status: job.status,
        progress: job.progress,
        reply: job.reply,
        ...(job.status === "done" ? { response: job.response } : {}),
        ...(job.error ? { error: job.error } : {}),
      };
    },

    follow(id, owner, after, listener) {
      const job = owned(id, owner);
      if (!job) return undefined;
      for (const entry of job.events) if (entry.id > after) listener(entry);
      if (job.status !== "running") return () => {};
      job.followers.add(listener);
      return () => { job.followers.delete(listener); };
    },

    cancel(id, owner) {
      const job = owned(id, owner);
      if (!job) return false;
      stop(job);
      return true;
    },

    forgetOwner(owner) {
      for (const [id, job] of jobs) {
        if (job.owner !== owner) continue;
        stop(job);
        jobs.delete(id);
      }
    },

    evict,
  };
}
