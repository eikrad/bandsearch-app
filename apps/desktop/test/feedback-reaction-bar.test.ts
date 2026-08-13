import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackReactionBar } from "../src/ui/FeedbackReactionBar.js";

test("FeedbackReactionBar renders 3 buttons when visible", () => {
  const html = renderToStaticMarkup(
    React.createElement(FeedbackReactionBar, {
      visible: true,
      onFeedback: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(html.includes("Spot on"), "missing Spot on button");
  assert.ok(html.includes("Too mainstream"), "missing Too mainstream button");
  assert.ok(html.includes("Wrong direction"), "missing Wrong direction button");
});

test("FeedbackReactionBar is hidden when visible=false", () => {
  const html = renderToStaticMarkup(
    React.createElement(FeedbackReactionBar, {
      visible: false,
      onFeedback: () => {},
      onDismiss: () => {},
    }),
  );
  assert.equal(html, "", "component should render nothing when visible=false");
});

test("FeedbackReactionBar renders label text", () => {
  const html = renderToStaticMarkup(
    React.createElement(FeedbackReactionBar, {
      visible: true,
      onFeedback: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(html.includes("feedback-reaction-bar"), "missing wrapper class");
});
