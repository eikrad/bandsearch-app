import { createHash } from "node:crypto";

/**
 * The rules of the translation routine (#329 step D), with no I/O, so the
 * scripts and the tests share them.
 *
 * English (`src/i18n/locales/en.json`) is the source. German and Danish are
 * drafted by a model (`translate.ts`), each string waits as a `draft` until a
 * person reviews it (`review.ts`), and `checkCatalog` keeps the catalogs
 * whole. A reviewed string is never redrafted unless its English changes.
 */

export type Catalog = { [key: string]: string | Catalog };
export type Flat = Record<string, string>;

export const TARGET_LANGUAGES = ["de", "da"] as const;
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

export type ReviewStatus = "draft" | "reviewed";
/** Per key: whether a person has accepted it, and the English it was made from. */
export type ReviewState = Record<string, { status: ReviewStatus; source: string }>;

export type GlossaryTranslation = { text: string; status: ReviewStatus };
/** A fixed rendering of a key term; `keep` terms (names) stay as they are in every language. */
export type GlossaryTerm =
  | { en: string; keep: true; note?: string }
  | ({ en: string; keep?: false; note?: string } & Record<TargetLanguage, GlossaryTranslation>);
export type Glossary = { style: Record<TargetLanguage, string>; terms: GlossaryTerm[] };

export function flatten(catalog: Catalog, prefix = ""): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

export function unflatten(flat: Flat): Catalog {
  const out: Catalog = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Catalog;
    node[parts.at(-1)!] = value;
  }
  return out;
}

/** Identifies the English text a translation was made from. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;

/**
 * Every key a language must have, with the English text it is made from. A
 * plural key gets the forms the language uses (`Intl.PluralRules`), each made
 * from the English form of the same name, or from `_other`.
 */
export function requiredKeys(en: Flat, language?: string): Map<string, string> {
  const out = new Map<string, string>();
  const forms = language ? new Intl.PluralRules(language).resolvedOptions().pluralCategories : null;
  for (const [key, text] of Object.entries(en)) {
    const plural = key.match(PLURAL);
    if (!plural || !forms) {
      out.set(key, text);
      continue;
    }
    for (const form of forms) {
      const target = `${plural[1]}_${form}`;
      if (!out.has(target)) out.set(target, en[target] ?? en[`${plural[1]}_other`] ?? text);
    }
  }
  return out;
}

/** Missing, new, or made from an English text that has changed since. Drafts and reviewed strings of the current English are kept. */
export function keysToTranslate(en: Flat, target: Flat, review: ReviewState, language?: string): string[] {
  return [...requiredKeys(en, language)].filter(
    ([key, source]) => target[key] === undefined || review[key]?.source !== sourceHash(source),
  ).map(([key]) => key);
}

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]!))].sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What the glossary requires of a translation of `source` into `language`. */
export function glossaryRequirements(source: string, language: TargetLanguage, glossary: Glossary): Array<{ term: string; expected: string }> {
  return glossary.terms
    .filter((term) => new RegExp(`\\b${escapeRegExp(term.en)}`, "i").test(source))
    .map((term) => ({ term: term.en, expected: term.keep ? term.en : term[language].text }));
}

export function checkCatalog(
  language: TargetLanguage,
  en: Flat,
  target: Flat,
  review: ReviewState,
  glossary: Glossary,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const required = requiredKeys(en, language);
  let drafts = 0;

  for (const [key, source] of required) {
    const text = target[key];
    if (text === undefined) {
      errors.push(`${key}: missing (npm run i18n:translate -- ${language})`);
      continue;
    }
    const state = review[key];
    if (!state || state.source !== sourceHash(source)) {
      errors.push(`${key}: the English text changed since this translation (npm run i18n:translate -- ${language})`);
    } else if (state.status === "draft") {
      drafts += 1;
    }
    const want = placeholders(source).join(", ");
    const got = placeholders(text).join(", ");
    if (want !== got) errors.push(`${key}: placeholders {${got}} differ from the English {${want}}`);
    for (const { term, expected } of glossaryRequirements(source, language, glossary)) {
      if (!text.toLowerCase().includes(expected.toLowerCase())) {
        errors.push(`${key}: the glossary renders "${term}" as "${expected}", which "${text}" does not use`);
      }
    }
  }
  for (const key of Object.keys(target)) {
    if (!required.has(key)) errors.push(`${key}: not in the English catalog`);
  }

  const glossaryDrafts = glossary.terms.filter((term) => !term.keep && term[language].status === "draft").length;
  const warnings: string[] = [];
  if (glossaryDrafts > 0) warnings.push(`${glossaryDrafts} glossary term(s) in ${language} still draft — review those first (npm run i18n:review -- ${language})`);
  if (drafts > 0) warnings.push(`${drafts} draft(s) in ${language} waiting for review (npm run i18n:review -- ${language})`);
  return { errors, warnings };
}
