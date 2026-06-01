const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("FeedbackReactionBar renders 3 buttons when visible", () => {
  const { FeedbackReactionBar } = require("../src/ui/FeedbackReactionBar");
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
  const { FeedbackReactionBar } = require("../src/ui/FeedbackReactionBar");
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
  const { FeedbackReactionBar } = require("../src/ui/FeedbackReactionBar");
  const html = renderToStaticMarkup(
    React.createElement(FeedbackReactionBar, {
      visible: true,
      onFeedback: () => {},
      onDismiss: () => {},
    }),
  );
  assert.ok(html.includes("feedback-reaction-bar"), "missing wrapper class");
});
