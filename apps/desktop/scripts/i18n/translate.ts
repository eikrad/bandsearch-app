import fs from "node:fs";
import path from "node:path";

import {
  TARGET_LANGUAGES,
  checkCatalog,
  flatten,
  glossaryRequirements,
  keysToTranslate,
  placeholders,
  requiredKeys,
  sourceHash,
  unflatten,
  type Flat,
  type Glossary,
  type ReviewState,
  type TargetLanguage,
} from "./catalog.js";
import { I18N_DIR, readJson, usedIn, writeJson } from "./files.js";

export type TranslationItem = { key: string; text: string; usedIn: string[]; glossary: Array<{ term: string; expected: string }> };
export type Translator = (batch: TranslationItem[]) => Promise<Record<string, string>>;

/**
 * Drafts every string that needs it (`keysToTranslate`), and every draft that
 * misses a glossary word, and marks the result `draft`. A draft that loses or invents a placeholder is not written: the
 * key stays untranslated and is reported.
 */
export async function translateCatalog({
  language,
  en,
  target,
  review,
  glossary,
  translate,
  usedIn: whereUsed,
  batchSize = 40,
}: {
  language: TargetLanguage;
  en: Flat;
  target: Flat;
  review: ReviewState;
  glossary: Glossary;
  translate: Translator;
  usedIn: (key: string) => string[];
  batchSize?: number;
}): Promise<{ target: Flat; review: ReviewState; translated: number; rejected: Array<{ key: string; reason: string }> }> {
  const sources = requiredKeys(en, language);
  const stale = keysToTranslate(en, target, review, language);
  // A draft that misses a glossary word (say, after the glossary changed) is drafted again.
  // A reviewed string is the person's decision and is only reported by the check.
  const offGlossary = [...sources].filter(([key, source]) => {
    const text = target[key];
    return text !== undefined && review[key]?.status === "draft" && !stale.includes(key) &&
      glossaryRequirements(source, language, glossary).some(({ expected }) => !text.toLowerCase().includes(expected.toLowerCase()));
  }).map(([key]) => key);
  const todo = [...stale, ...offGlossary];
  const nextTarget = { ...target };
  const nextReview = { ...review };
  const rejected: Array<{ key: string; reason: string }> = [];
  let translated = 0;

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize).map((key) => {
      const text = sources.get(key)!;
      return { key, text, usedIn: whereUsed(key), glossary: glossaryRequirements(text, language, glossary) };
    });
    const drafts = await translate(batch);
    for (const { key, text } of batch) {
      const draft = drafts[key];
      if (typeof draft !== "string" || !draft.trim()) {
        rejected.push({ key, reason: "the model returned no text" });
        continue;
      }
      if (placeholders(draft).join() !== placeholders(text).join()) {
        rejected.push({ key, reason: `placeholders {${placeholders(draft).join(", ")}} differ from the English {${placeholders(text).join(", ")}}` });
        continue;
      }
      nextTarget[key] = draft;
      nextReview[key] = { status: "draft", source: sourceHash(text) };
      translated += 1;
    }
  }
  // Written in the English order, so a diff of the catalogs reads like the source.
  const ordered: Flat = {};
  for (const key of sources.keys()) if (nextTarget[key] !== undefined) ordered[key] = nextTarget[key]!;
  return { target: ordered, review: nextReview, translated, rejected };
}

const LANGUAGE_NAMES: Record<TargetLanguage, string> = { de: "German", da: "Danish" };

/** A translator on Scaleway's OpenAI-compatible API (the project's LLM provider). */
export function scalewayTranslator({
  language,
  glossary,
  apiKey,
  model,
  baseUrl = "https://api.scaleway.ai/v1",
  fetchImpl = fetch,
}: {
  language: TargetLanguage;
  glossary: Glossary;
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Translator {
  const system = [
    `You translate the user interface of Bandsearch, a desktop app for discovering niche music, from English into ${LANGUAGE_NAMES[language]}.`,
    glossary.style[language],
    "Keep every {{placeholder}} exactly as it is. Keep arrows (← →), the ellipsis (…), URLs, file names and product names (Bandsearch, MusicBrainz, Last.fm, Scaleway, Brave Search, Turso, SQLite) unchanged.",
    "Keep each text about as short as the English: these are buttons, labels and short messages. Match the tone: plain, friendly, no exclamation marks the English does not have.",
    "Each item lists glossary terms that must appear in its translation; use exactly those words, inflected only where the grammar requires it.",
    'Answer with one JSON object that maps each key to its translation, nothing else: {"<key>": "<translation>", ...}.',
  ].join(" ");

  return async (batch) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(batch, null, 2) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Scaleway answered ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, string>;
  };
}

async function main(): Promise<void> {
  const repoEnv = path.join(I18N_DIR, "..", "..", "..", "..", ".env");
  if (!process.env.SCW_SECRET_KEY && fs.existsSync(repoEnv)) process.loadEnvFile(repoEnv);
  const apiKey = process.env.SCW_SECRET_KEY?.trim();
  if (!apiKey) throw new Error("SCW_SECRET_KEY is required (in the environment or the repository's .env)");
  const model = process.env.I18N_MODEL?.trim() || "mistral-medium-3.5-128b";

  const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const languages = asked.length ? asked : [...TARGET_LANGUAGES];
  const en = flatten(readJson(path.join(I18N_DIR, "locales", "en.json")));
  const glossary = readJson(path.join(I18N_DIR, "glossary.json")) as unknown as Glossary;

  let failed = false;
  for (const language of languages) {
    if (!(TARGET_LANGUAGES as readonly string[]).includes(language)) throw new Error(`unknown language "${language}"; use ${TARGET_LANGUAGES.join(" or ")}`);
    const lang = language as TargetLanguage;
    const targetFile = path.join(I18N_DIR, "locales", `${lang}.json`);
    const reviewFile = path.join(I18N_DIR, "review", `${lang}.json`);
    const result = await translateCatalog({
      language: lang,
      en,
      target: flatten(readJson(targetFile)),
      review: readJson(reviewFile) as unknown as ReviewState,
      glossary,
      usedIn,
      translate: scalewayTranslator({ language: lang, glossary, apiKey, model, baseUrl: process.env.SCW_BASE_URL?.trim() || undefined }),
    });
    writeJson(targetFile, unflatten(result.target));
    writeJson(reviewFile, result.review);
    console.log(`${lang}: ${result.translated} string(s) drafted with ${model}`);
    for (const { key, reason } of result.rejected) console.log(`  not written ${key}: ${reason}`);
    const { errors, warnings } = checkCatalog(lang, en, result.target, result.review, glossary);
    for (const error of errors) console.log(`  ✗ ${error}`);
    for (const warning of warnings) console.log(`  · ${warning}`);
    failed ||= errors.length > 0;
  }
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
