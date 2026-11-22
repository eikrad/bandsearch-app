import type { Request, Response } from "express";

import type { AnswerEvent } from "../../../../shared/schemas/src/contracts.js";

/** The reply grows on screen about this often. */
const REPLY_INTERVAL_MS = 50;

export type AnswerStream = {
  /** Sends an event; the first one opens the stream. Ignored once the client is gone. */
  send(event: AnswerEvent): void;
  /** Whether the stream is open: from then on the answer, or its error, has to go through it. */
  isOpen(): boolean;
  end(): void;
};

/** Server-sent events for a request that asked for them, else null. */
export function answerStreamFor(req: Request, res: Response): AnswerStream | null {
  if (!String(req.headers.accept ?? "").includes("text/event-stream")) return null;
  let open = false;
  let lastReplyAt = 0;
  return {
    send(event) {
      if (res.writableEnded || res.destroyed) return;
      // Every token would repeat the whole reply; `done` carries the final text.
      if (event.type === "reply") {
        if (Date.now() - lastReplyAt < REPLY_INTERVAL_MS) return;
        lastReplyAt = Date.now();
      }
      if (!open) {
        open = true;
        res.status(200).set({
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          // Proxies that buffer would deliver the whole stream at once.
          "x-accel-buffering": "no",
        });
        res.flushHeaders();
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    isOpen: () => open,
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}
