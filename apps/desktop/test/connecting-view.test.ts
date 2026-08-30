import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectingView } from "../src/ui/ConnectingView.js";

const render = (viewProps: Parameters<typeof ConnectingView>[0]["viewProps"], onRetry = () => {}) =>
  renderToStaticMarkup(React.createElement(ConnectingView, { viewProps, handlers: { onRetry } }));

test("while waiting, the screen says the server is starting", () => {
  const html = render({ state: "waiting", attempt: 1 });

  // The whole point of #155: the user must learn the server is waking, not be
  // dropped into an app whose every request fails.
  assert.match(html, /starting/i);
});

test("while waiting, no retry button is offered", () => {
  // Retrying by hand is meaningless while an automatic retry is already running.
  assert.equal(render({ state: "waiting", attempt: 3 }).includes("<button"), false);
});

test("a long wait is acknowledged rather than looking hung", () => {
  const early = render({ state: "waiting", attempt: 1 });
  const late = render({ state: "waiting", attempt: 6 });

  assert.notEqual(early, late, "the screen must change as attempts pile up");
  assert.match(late, /still/i);
});

test("giving up offers a way to try again", () => {
  const html = render({ state: "failed" });

  assert.match(html, /could not|unreachable|reach/i);
  assert.match(html, /<button/);
});

test("the retry button is wired to the handler", () => {
  let retried = 0;
  // Called directly rather than through createElement: the component is pure, and
  // the assertion is about the handler it assigns, which markup cannot show.
  const tree = ConnectingView({
    viewProps: { state: "failed" },
    handlers: { onRetry: () => { retried += 1; } },
  });

  const button = findButton(tree);
  assert.ok(button, "expected a retry button");
  button.props.onClick?.();
  assert.equal(retried, 1);
});

type El = React.ReactElement<{ onClick?: () => void; children?: unknown }>;

function findButton(node: unknown): El | undefined {
  if (!React.isValidElement(node)) return undefined;
  const el = node as El;
  if (el.type === "button") return el;
  const kids = el.props.children;
  for (const child of Array.isArray(kids) ? kids : [kids]) {
    const found = findButton(child);
    if (found) return found;
  }
  return undefined;
}
