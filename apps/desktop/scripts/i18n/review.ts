import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  TARGET_LANGUAGES,
  flatten,
  glossaryRequirements,
  requiredKeys,
  sourceHash,
  unflatten,
  type Flat,
  type Glossary,
  type ReviewState,
  type TargetLanguage,
} from "./catalog.js";
import { I18N_DIR, readJson, usedIn, writeJson } from "./files.js";

export type ReviewItem =
  | { kind: "term"; term: string }
  | { kind: "string"; key: string; source: string };

export type Decision = { action: "accept" } | { action: "edit"; text: string } | { action: "reject" } | { action: "skip" };

/**
 * What waits for a person, glossary first: every string's translation depends
 * on it. Then the draft strings, in the English order.
 */
export function reviewQueue(language: TargetLanguage, en: Flat, target: Flat, review: ReviewState, glossary: Glossary): ReviewItem[] {
  const terms: ReviewItem[] = glossary.terms
    .filter((term) => !term.keep && term[language].status === "draft")
    .map((term) => ({ kind: "term", term: term.en }));
  const strings: ReviewItem[] = [...requiredKeys(en, language)]
    .filter(([key, source]) => target[key] !== undefined && review[key]?.status === "draft" && review[key]?.source === sourceHash(source))
    .map(([key, source]) => ({ kind: "string", key, source }));
  return [...terms, ...strings];
}

/** Applies one decision on a string. A rejected draft is removed, so the next translate run drafts it again. */
export function applyDecision(
  state: { target: Flat; review: ReviewState },
  item: Extract<ReviewItem, { kind: "string" }>,
  decision: Decision,
): void {
  const reviewed = { status: "reviewed" as const, source: sourceHash(item.source) };
  if (decision.action === "accept") state.review[item.key] = reviewed;
  if (decision.action === "edit") {
    state.target[item.key] = decision.text;
    state.review[item.key] = reviewed;
  }
  if (decision.action === "reject") {
    delete state.target[item.key];
    delete state.review[item.key];
  }
}

/** Accepting or editing a glossary term makes it reviewed; there is nothing to reject, only a better word. */
export function applyTermDecision(glossary: Glossary, language: TargetLanguage, term: string, decision: Decision): void {
  const entry = glossary.terms.find((t) => t.en === term);
  if (!entry || entry.keep) return;
  if (decision.action === "accept") entry[language].status = "reviewed";
  if (decision.action === "edit") entry[language] = { text: decision.text, status: "reviewed" };
}

async function main(): Promise<void> {
  const language = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!language || !(TARGET_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error(`usage: npm run i18n:review -- <${TARGET_LANGUAGES.join("|")}>`);
  }
  const lang = language as TargetLanguage;
  const enFile = path.join(I18N_DIR, "locales", "en.json");
  const targetFile = path.join(I18N_DIR, "locales", `${lang}.json`);
  const reviewFile = path.join(I18N_DIR, "review", `${lang}.json`);
  const glossaryFile = path.join(I18N_DIR, "glossary.json");

  const en = flatten(readJson(enFile));
  const glossary = readJson(glossaryFile) as unknown as Glossary;
  const state = { target: flatten(readJson(targetFile)), review: readJson(reviewFile) as unknown as ReviewState };
  const queue = reviewQueue(lang, en, state.target, state.review, glossary);
  if (queue.length === 0) {
    console.log(`Nothing to review in ${lang}.`);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const save = () => {
    writeJson(targetFile, unflatten(state.target));
    writeJson(reviewFile, state.review);
    writeJson(glossaryFile, glossary);
  };
  try {
    for (const [index, item] of queue.entries()) {
      console.log(`\n[${index + 1}/${queue.length}]`);
      if (item.kind === "term") {
        const entry = glossary.terms.find((t) => t.en === item.term)!;
        if (entry.keep) continue;
        console.log(`  glossary term: ${item.term}${entry.note ? `  (${entry.note})` : ""}`);
        console.log(`  ${lang}: ${entry[lang].text}`);
      } else {
        console.log(`  ${item.key}   ${usedIn(item.key).slice(0, 3).join(", ")}`);
        console.log(`  en: ${item.source}`);
        console.log(`  ${lang}: ${state.target[item.key]}`);
        for (const { term, expected } of glossaryRequirements(item.source, lang, glossary)) console.log(`  glossary: "${term}" → "${expected}"`);
      }
      const answer = (await rl.question(`  (a)ccept  (e)dit  ${item.kind === "string" ? "(r)eject  " : ""}(s)kip  (q)uit > `)).trim().toLowerCase();
      if (answer === "q") break;
      let decision: Decision = { action: "skip" };
      if (answer === "a") decision = { action: "accept" };
      if (answer === "r" && item.kind === "string") decision = { action: "reject" };
      if (answer === "e") {
        const text = (await rl.question("  new text > ")).trim();
        if (text) decision = { action: "edit", text };
      }
      if (item.kind === "term") applyTermDecision(glossary, lang, item.term, decision);
      else applyDecision(state, item, decision);
      save();
    }
  } finally {
    rl.close();
  }
  console.log("\nSaved. Run npm run i18n:check to see what is left.");
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
