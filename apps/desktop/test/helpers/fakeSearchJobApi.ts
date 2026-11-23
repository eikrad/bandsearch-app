// Test doubles for the search job API (ADR 0006): POST /recommendations/jobs
// starts a search, GET on the job follows its server-sent events, DELETE stops it.

import { jsonResponse } from "./fakeResponse.js";

/** One server-sent event, with its id when it has one. */
export function frame(event: unknown, id?: number): string {
  return `${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`;
}

/** An event stream that delivers `chunks` and ends. */
export function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

/** An event stream the test writes to as it goes; it ends only when told, or when the request is aborted. */
export function liveSseResponse(signal?: AbortSignal | null) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  signal?.addEventListener("abort", () => {
    try { controller.error(new DOMException("Aborted", "AbortError")); } catch { /* already closed */ }
  }, { once: true });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
    send: (event: unknown, id?: number) => controller.enqueue(encoder.encode(frame(event, id))),
    /** The connection drops without the job having ended. */
    drop: () => controller.close(),
  };
}

export const jobNotFound = () =>
  jsonResponse({ error: { code: "search_job_not_found", message: "search job not found" } }, { status: 404 });

/**
 * Serves the job endpoints from a fake of the older held-request API: a
 * started job asks `fetchImpl` at `/recommendations` with the same body, and
 * following it turns that answer into the job's end (`done`, or `error` for a
 * failed status, or `cancelled` once stopped). Lets tests about what the chat
 * does with an answer stay about that.
 */
export function withSearchJobs(fetchImpl: typeof fetch): typeof fetch {
  const jobs = new Map<string, { answer: Promise<Response>; stop: AbortController; ended?: Promise<string> }>();
  let started = 0;

  async function endOf(answer: Promise<Response>): Promise<string> {
    try {
      const response = await answer;
      const body = (await response.json()) as Record<string, unknown>;
      if (response.ok) return frame({ type: "done", response: body }, 1);
      return frame({ type: "error", status: response.status, error: body.error }, 1);
    } catch {
      return frame({ type: "cancelled" }, 1);
    }
  }

  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const match = /\/recommendations\/jobs(?:\/([^/?]+))?/.exec(url);
    if (!match) return fetchImpl(input, init);
    const method = init.method ?? "GET";

    if (!match[1] && method === "POST") {
      const jobId = `job-${++started}`;
      const stop = new AbortController();
      const answer = Promise.resolve(fetchImpl(`${url.slice(0, match.index)}/recommendations`, { ...init, signal: stop.signal }));
      answer.catch(() => {});
      jobs.set(jobId, { answer, stop });
      return jsonResponse({ jobId }, { status: 202 });
    }

    const job = jobs.get(decodeURIComponent(match[1] ?? ""));
    if (!job) return jobNotFound();
    if (method === "DELETE") {
      job.stop.abort();
      return new Response(null, { status: 204 });
    }
    job.ended ??= endOf(job.answer);
    const ended = await new Promise<string>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      job.ended!.then(resolve, reject);
    });
    return sseResponse([ended]);
  }) as typeof fetch;
}
