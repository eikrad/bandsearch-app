import type { AnswerEvent, AnswerProgress } from "../../../shared/schemas/src/contracts.js";

/** One server-sent event: its id (to resume after) when it has one. */
export type ReadAnswerEvent = { id: number | null; event: AnswerEvent };

function parseBlock(block: string): ReadAnswerEvent | null {
  let id: number | null = null;
  let data: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = Number(line.slice("id: ".length));
    else if (line.startsWith("data: ")) data = line.slice("data: ".length);
  }
  // A comment (": keep-alive") carries nothing.
  if (data === null) return null;
  return { id: Number.isSafeInteger(id) ? id : null, event: JSON.parse(data) as AnswerEvent };
}

/** The server-sent events of a response body, as they arrive. */
export async function* readAnswerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ReadAnswerEvent> {
  const reader = body.pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>).getReader();
  let unread = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      unread += value;
      for (let end = unread.indexOf("\n\n"); end !== -1; end = unread.indexOf("\n\n")) {
        const parsed = parseBlock(unread.slice(0, end));
        unread = unread.slice(end + 2);
        if (parsed) yield parsed;
      }
    }
  } finally {
    // Leaving early (an error, or the final event) closes the connection.
    await reader.cancel().catch(() => {});
  }
}

function listOf(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What the assistant is doing, in a short line (UI_GUIDELINES, "Chat and request states"). */
export function progressLabel(progress: AnswerProgress | null): string {
  switch (progress?.stage) {
    case "thinking":
      return "Thinking…";
    case "searching":
      return progress.anchorArtists.length > 0
        ? `Looking for bands near ${listOf(progress.anchorArtists.slice(0, 3))}…`
        : "Searching the web…";
    case "checking":
      return progress.found > 0 ? `Found ${progress.found} bands, checking them…` : "Checking what turned up…";
    case "searchingAgain":
      return "Too few good matches yet, searching once more…";
    case "choosing":
      return "Choosing the best matches…";
    default:
      return "Sending your message…";
  }
}
