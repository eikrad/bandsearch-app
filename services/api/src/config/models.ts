/**
 * The chat model every research node uses unless configured otherwise.
 *
 * One definition instead of a default per node: the four nodes used to repeat
 * this string, so changing the model was four edits with nothing to catch a
 * missed one, and no single value could be reported as the response's
 * provenance (EU AI Act Art. 50(2), #134).
 */
export const DEFAULT_RESEARCH_MODEL = "gemini-2.5-flash";
