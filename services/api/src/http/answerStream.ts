import type { Request, Response } from "express";

import type { AnswerEvent } from "../../../../shared/schemas/src/contracts.js";

/** The reply grows on screen about this often. */
const REPLY_INTERVAL_MS = 50;
/** A quiet stretch of a search must not look like a dead connection to a proxy or the app. */
const KEEP_ALIVE_MS = 15_000;

export type AnswerStream = {
  /** Sends an event; the first one opens the stream. Ignored once the client is gone. */
  send(event: AnswerEvent, id?: number): void;
  /** Whether the stream is open: from then on the answer, or its error, has to go through it. */
  isOpen(): boolean;
  end(): void;
};

export function wantsEventStream(req: Request): boolean {
  return String(req.headers.accept ?? "").includes("text/event-stream");
}

/** Server-sent events on `res`, opened by the first event (or by `open()`). */
function eventStream(res: Response) {
  let open = false;
  let lastReplyAt = 0;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const gone = () => res.writableEnded || res.destroyed;

  function stopKeepAlive() {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
  }

  function openStream() {
    if (open) return;
    open = true;
    res.status(200).set({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Proxies that buffer would deliver the whole stream at once.
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    keepAlive = setInterval(() => { if (!gone()) res.write(": keep-alive\n\n"); }, KEEP_ALIVE_MS);
    keepAlive.unref?.();
    res.on("close", stopKeepAlive);
  }

  return {
    open: openStream,
    send(event: AnswerEvent, id?: number) {
      if (gone()) return;
      // Every token would repeat the whole reply; a later one, or `done`, carries it.
      if (event.type === "reply") {
        if (Date.now() - lastReplyAt < REPLY_INTERVAL_MS) return;
        lastReplyAt = Date.now();
      }
      openStream();
      res.write(`${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`);
    },
    isOpen: () => open,
    end() {
      stopKeepAlive();
      if (!res.writableEnded) res.end();
    },
  };
}

/** Server-sent events for a request that asked for them, else null. Opens with the first event. */
export function answerStreamFor(req: Request, res: Response): AnswerStream | null {
  return wantsEventStream(req) ? eventStream(res) : null;
}

/** Server-sent events opened now, so the client knows it is attached before anything happens. */
export function openAnswerStream(res: Response): AnswerStream {
  const stream = eventStream(res);
  stream.open();
  return stream;
}
