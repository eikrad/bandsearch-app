export const SEARCH_HIT_FIELD_MAX = 500;
export const SEARCH_HIT_URL_MAX = 300;
export const HISTORY_CONTENT_CAP = 4000;

export type HistoryMessage = { role: string; content: string };

export type SearchHit = {
  sourceQuery: string;
  title: string;
  url: string;
  description: string;
};

export function capAndTrim(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function escapeEnvelopeChars(s: string): string {
  return s.replace(/\[\/[A-Z_]+\]/g, (m) => m.replace("[/", "[\\/"));
}

export function wrapBlock(tag: string, content: string): string {
  const c = content.trim();
  return c ? `[${tag}]\n${c}\n[/${tag}]` : "";
}

export function wrapUserContent(query: string): string {
  const c = query.trim();
  return c ? wrapBlock("USER_INPUT", escapeEnvelopeChars(c)) : "";
}

export function wrapPreferenceContext(pref: string): string {
  const c = pref.trim();
  return c ? wrapBlock("USER_PREFERENCES", escapeEnvelopeChars(c)) : "";
}

export function wrapSearchHitBlock(hit: SearchHit): string {
  const sourceQuery = capAndTrim(escapeEnvelopeChars(hit.sourceQuery), SEARCH_HIT_FIELD_MAX);
  const title = capAndTrim(escapeEnvelopeChars(hit.title), SEARCH_HIT_FIELD_MAX);
  const url = capAndTrim(hit.url.split(/[\r\n]/)[0], SEARCH_HIT_URL_MAX);
  const description = capAndTrim(escapeEnvelopeChars(hit.description), SEARCH_HIT_FIELD_MAX);
  const inner = [`query: ${sourceQuery}`, `title: ${title}`, `url: ${url}`, `description: ${description}`].join("\n");
  return wrapBlock("SEARCH_RESULT", inner);
}

export function formatHistoryBlock(messages: HistoryMessage[], maxTotalChars: number): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lines: string[] = [];
  let total = 0;
  let omitted = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = capAndTrim(String(m.content ?? ""), HISTORY_CONTENT_CAP);
    if (!content) continue;
    const line = `${m.role}: ${content}`;
    if (total + line.length + 1 > maxTotalChars) {
      omitted = true;
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  if (omitted) lines.push("… (earlier messages omitted)");
  return lines.reverse().join("\n");
}
