import path from "node:path";

import { TARGET_LANGUAGES, checkCatalog, flatten, type Glossary, type ReviewState } from "./catalog.js";
import { I18N_DIR, readJson } from "./files.js";

/** The check over the catalogs the app ships, per language. */
export function checkShippedCatalogs(): Array<{ language: string; errors: string[]; warnings: string[] }> {
  const en = flatten(readJson(path.join(I18N_DIR, "locales", "en.json")));
  const glossary = readJson(path.join(I18N_DIR, "glossary.json")) as unknown as Glossary;
  return TARGET_LANGUAGES.map((language) => ({
    language,
    ...checkCatalog(
      language,
      en,
      flatten(readJson(path.join(I18N_DIR, "locales", `${language}.json`))),
      readJson(path.join(I18N_DIR, "review", `${language}.json`)) as unknown as ReviewState,
      glossary,
    ),
  }));
}

if (require.main === module) {
  let failed = false;
  for (const { language, errors, warnings } of checkShippedCatalogs()) {
    console.log(`${language}: ${errors.length ? `${errors.length} error(s)` : "ok"}`);
    for (const error of errors) console.log(`  ✗ ${error}`);
    for (const warning of warnings) console.log(`  · ${warning}`);
    failed ||= errors.length > 0;
  }
  if (failed) process.exitCode = 1;
}
