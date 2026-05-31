const URL_REGEX = /https?:\/\/[^\s)>",]+/g;

const GENERIC_PHRASES = [
  "known for their",
  "known for its",
  "similar to",
  "if you enjoy",
  "if you like",
  "fans of",
  "influenced by",
  "reminiscent of",
  "in the vein of",
];

export type EvidenceReport = {
  citationSupportRate: number;
  genericWhyFlag: boolean;
};

/**
 * Checks evidence quality for a single recommendation's why text.
 *
 * citationSupportRate: fraction of URLs extracted from `why` that also appear
 * in `signals`. Returns 1.0 when why contains no URLs (vacuously supported).
 *
 * genericWhyFlag: true when why contains boilerplate phrasing that suggests
 * the model didn't draw on specific evidence.
 */
export function checkEvidence(why: string, signals: string[]): EvidenceReport {
  const whyUrls = why.match(URL_REGEX) ?? [];

  let citationSupportRate: number;
  if (whyUrls.length === 0) {
    citationSupportRate = 1.0;
  } else {
    const supported = whyUrls.filter((url) => signals.includes(url)).length;
    citationSupportRate = supported / whyUrls.length;
  }

  const lower = why.toLowerCase();
  const genericWhyFlag = GENERIC_PHRASES.some((phrase) => lower.includes(phrase));

  return { citationSupportRate, genericWhyFlag };
}
