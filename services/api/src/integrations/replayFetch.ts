import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Record-and-replay for the external lookups of an eval run (Brave,
 * MusicBrainz, Last.fm). The first request goes upstream and its answer is
 * stored; the same request later gets the stored answer. Two golden runs on
 * different models then see the same search and verification data, so a
 * difference between them comes from the model, and repeat runs no longer
 * wait on MusicBrainz's 1 req/s limit.
 *
 * Eval only: enabled by EVAL_REPLAY_DIR. LLM calls never go through it.
 */

type Recording = { url: string; status: number; contentType: string; body: string };

/** Query parameters that carry credentials: never part of a key or a file. */
const SECRET_PARAMS = ["api_key", "apikey", "token", "key"];

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of SECRET_PARAMS) parsed.searchParams.delete(name);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 2xx and 404 are answers; 404 means "no such artist". Errors are retried next run. */
function isRecordable(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404;
}

export function createReplayFetch({
  dir,
  fetchImpl = globalThis.fetch,
  minIntervalMsByHost = {},
}: {
  dir: string;
  fetchImpl?: typeof fetch;
  /** Spacing for real upstream calls per host, e.g. MusicBrainz's 1 req/s; replays are never delayed. */
  minIntervalMsByHost?: Record<string, number>;
}): typeof fetch {
  const lastStartByHost = new Map<string, number>();
  const chainByHost = new Map<string, Promise<unknown>>();

  function throttled<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const interval = minIntervalMsByHost[host] ?? 0;
    if (interval <= 0) return fn();
    const run = (chainByHost.get(host) ?? Promise.resolve()).then(async () => {
      const wait = (lastStartByHost.get(host) ?? 0) + interval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStartByHost.set(host, Date.now());
      return fn();
    });
    chainByHost.set(host, run.catch(() => undefined));
    return run;
  }

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = redact(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const host = new URL(request.url).hostname;
    const key = createHash("sha256").update(`${request.method} ${url}\n${body}`).digest("hex").slice(0, 32);
    const file = join(dir, host, `${key}.json`);

    if (existsSync(file)) {
      const recorded = JSON.parse(readFileSync(file, "utf8")) as Recording;
      return new Response(recorded.status === 204 ? null : recorded.body, {
        status: recorded.status,
        headers: { "content-type": recorded.contentType },
      });
    }

    const response = await throttled(host, () => fetchImpl(request));
    if (isRecordable(response.status)) {
      const recording: Recording = {
        url,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "application/json",
        body: await response.clone().text(),
      };
      mkdirSync(join(dir, host), { recursive: true });
      writeFileSync(file, JSON.stringify(recording), "utf8");
    }
    return response;
  }) as typeof fetch;
}
