/**
 * The reply language rule (#329): every text the user reads follows the
 * language of their newest message, not the app's UI language (owner
 * decision, 2026-11-23). A German question gets a German reply and German
 * why texts, even in an English UI.
 *
 * The one home of the rule: the ranker and the answer writer put it in their
 * prompts, and the judge scores against it. Search queries are not
 * user-facing and stay language-neutral; the planner's prompt does not read
 * this.
 */
/**
 * Text that stays in its own language inside a reply. The search keeps it and
 * the judge does not count it against a why, so both read this one phrase.
 * Quotes are on the list because the ranker asks each why to quote its
 * evidence; the judge once took an English quote in a Danish why for an
 * English why (baseline of 2026-11-23).
 */
export const KEPT_AS_IS =
  "Band names, album and song titles, genre tags, URLs and words quoted word for word from a source";

export const REPLY_LANGUAGE_RULE = `Write every text the user reads (the reply and each why) in the language of the user's newest message, whatever language earlier messages or the evidence are in. ${KEPT_AS_IS} stay as they are.`;

/** The most evidence_quality a why in another language than the query can score. */
export const REPLY_LANGUAGE_EVIDENCE_CAP = 0.3;

/**
 * How the judge applies the rule: part of `evidence_quality`, not a dimension
 * of its own. The judge only reports the languages; the cap is applied in
 * code (`capEvidenceForReplyLanguage`), because gemma-4-26b named both
 * languages correctly and still scored an English why to a German query 1.0
 * (probe of 2026-11-23).
 */
export const REPLY_LANGUAGE_JUDGE_RULE = `A why written in another language than the query is of little use to that user. For each band, give query_language (the language of the query, as an ISO 639-1 code such as en, de or da), why_language (the language of the why's own sentences, as a code too; ${KEPT_AS_IS} do not count) and why_in_query_language (true when the two are the same). Score evidence_quality on the evidence alone: a why in another language is capped afterwards.`;

/** The judge's evidence score, capped when it found the why in another language than the query. */
export function capEvidenceForReplyLanguage(evidenceQuality: unknown, whyInQueryLanguage: unknown): unknown {
  if (whyInQueryLanguage !== false || typeof evidenceQuality !== "number") return evidenceQuality;
  return Math.min(evidenceQuality, REPLY_LANGUAGE_EVIDENCE_CAP);
}
