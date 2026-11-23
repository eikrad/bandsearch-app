import i18next from "i18next";
// Initialises i18next the way the app does.
import "../../src/i18n/i18n.js";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/** A translation key as i18next's `cimode` prints it: `section.key`, dotted, no spaces. */
const KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

/** Visible text and the attributes a user reads or hears. */
const READ_ATTRIBUTES = /\s(?:placeholder|aria-label|title|alt)="([^"]*)"/g;

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

/**
 * Renders a view with i18next in `cimode`, where `t` returns the key instead
 * of a text, and lists every piece of text that is still not a key: a string
 * the view writes out itself instead of reading it from the catalog (#329).
 * `data` lists values the view is given (names, counts, URLs), which are not
 * the view's own text.
 */
export async function untranslatedText(element: ReactElement, data: readonly string[] = []): Promise<string[]> {
  const before = i18next.language;
  await i18next.changeLanguage("cimode");
  try {
    const html = renderToStaticMarkup(element);
    const pieces = [
      ...html.replace(/<[^>]+>/g, "\n").split("\n"),
      ...[...html.matchAll(READ_ATTRIBUTES)].map((m) => m[1]!),
    ];
    return pieces
      .map((piece) => decode(piece).trim())
      .filter((piece) => /\p{L}/u.test(piece))
      .filter((piece) => !KEY.test(piece))
      .filter((piece) => !data.some((value) => piece === value || piece.includes(value)));
  } finally {
    await i18next.changeLanguage(before);
  }
}
