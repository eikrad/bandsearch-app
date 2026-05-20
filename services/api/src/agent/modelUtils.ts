/**
 * Extract one balanced JSON object or array from text that may include model preamble or trailing prose.
 */
export function parseModelJsonResponse(raw: string): unknown {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const objStart = text.indexOf("{");
    const arrStart = text.indexOf("[");
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const slice = extractBalancedSegment(text, objStart, "{", "}");
      if (slice) {
        try {
          return JSON.parse(slice) as unknown;
        } catch {
          /* try array path */
        }
      }
    }
    if (arrStart !== -1) {
      const slice = extractBalancedSegment(text, arrStart, "[", "]");
      if (slice) {
        return JSON.parse(slice) as unknown;
      }
    }
    throw new Error("invalid recommendation output");
  }
}

function extractBalancedSegment(s: string, startIdx: number, open: string, close: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  const quote = '"';
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === quote) {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return s.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage = "recommendation model timeout"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}
