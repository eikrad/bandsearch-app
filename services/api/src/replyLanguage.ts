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
export const REPLY_LANGUAGE_RULE =
  "Write every text the user reads (the reply and each why) in the language of the user's newest message, whatever language earlier messages or the evidence are in. Band names, album and song titles, genre tags and URLs stay as they are.";

/** How the judge applies the rule: part of `evidence_quality`, not a dimension of its own. */
export const REPLY_LANGUAGE_JUDGE_RULE =
  "A why written in another language than the query is of little use to that user: score its evidence_quality low (at most 0.3), however well it is sourced. Band names, titles, genre tags and URLs do not count as another language.";
