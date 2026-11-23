import i18next from "i18next";

import en from "./locales/en.json";
import de from "./locales/de.json";
import da from "./locales/da.json";

/**
 * The app's UI languages (#329). English is the source: every key exists in
 * `en.json`, and German and Danish are derived from it. A key missing in one
 * of them falls back to English.
 *
 * Chat replies do not follow this setting: they follow the language of the
 * user's message (services/api/src/replyLanguage.ts).
 */
export const SUPPORTED_LANGUAGES = ["en", "de", "da"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Each language named in itself, so a user can find theirs whatever is set. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", de: "Deutsch", da: "Dansk" };

export const resources = {
  en: { translation: en },
  de: { translation: de },
  da: { translation: da },
} as const;

const STORAGE_KEY = "bandsearch.language";

export type LanguageStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** The first of the system's languages that Bandsearch speaks, by primary subtag; English otherwise. */
export function detectLanguage(systemLanguages: readonly string[]): Language {
  for (const tag of systemLanguages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(primary)) return primary;
  }
  return "en";
}

/** A language the user chose wins; a stored value Bandsearch does not know is ignored. */
export function chooseInitialLanguage({ stored, system }: { stored: string | null; system: readonly string[] }): Language {
  return isLanguage(stored) ? stored : detectLanguage(system);
}

/** localStorage, or nothing where it is blocked (private mode, tests): the choice then lasts one run. */
function browserStorage(): LanguageStorage | null {
  try {
    // Through `window`: Node has an experimental global localStorage that warns when touched.
    return (globalThis as { window?: { localStorage?: LanguageStorage } }).window?.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(storage: LanguageStorage | null): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function systemLanguages(): readonly string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  return nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
}

function markDocument(language: Language): void {
  const root = (globalThis as { document?: { documentElement?: { lang: string } } }).document?.documentElement;
  if (root) root.lang = language;
}

const initial = chooseInitialLanguage({ stored: readStored(browserStorage()), system: systemLanguages() });

void i18next.init({
  resources,
  lng: initial,
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  // Synchronous, so the first render and every test already have the text.
  initAsync: false,
  // React escapes text itself.
  interpolation: { escapeValue: false },
  returnNull: false,
});
markDocument(initial);

export function currentLanguage(): Language {
  // The chosen language, not `resolvedLanguage`: that one skips a language whose catalog is still empty.
  return isLanguage(i18next.language) ? i18next.language : "en";
}

/** Switches every mounted view at once and remembers the choice for the next start. */
export async function setLanguage(language: Language, storage: LanguageStorage | null = browserStorage()): Promise<void> {
  await i18next.changeLanguage(language);
  markDocument(language);
  try {
    storage?.setItem(STORAGE_KEY, language);
  } catch {
    // Blocked storage: the choice lasts this run only.
  }
}

/**
 * The text for a key, in the current language. Views call it while they
 * render, so they stay pure functions of their props; the app renders again
 * when the language changes (`onLanguageChange`).
 */
export const t = i18next.t.bind(i18next);

/** Tells `listener` after every language change; returns the unsubscribe. */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  const handler = () => listener(currentLanguage());
  i18next.on("languageChanged", handler);
  return () => i18next.off("languageChanged", handler);
}

/** "A, B and C" in the current language. */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(currentLanguage(), { type: "conjunction" }).format(items);
}

/** A calendar date (`YYYY-MM-DD`) written out in the current language, read as that day wherever the user is. */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat(currentLanguage(), { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** A count with the current language's digit grouping. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(currentLanguage()).format(value);
}
