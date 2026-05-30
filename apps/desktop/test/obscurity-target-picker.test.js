const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { ObscurityTargetPicker } = require("../src/components/ObscurityTargetPicker");

test("ObscurityTargetPicker renders three buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, { target: null, onTargetChange: () => {} }),
  );
  assert.ok(html.includes("Cult Following"), "renders Cult Following");
  assert.ok(html.includes("Underground"), "renders Underground");
  assert.ok(html.includes("Truly Obscure"), "renders Truly Obscure");
});

test("ObscurityTargetPicker marks matching target as active", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, { target: "underground", onTargetChange: () => {} }),
  );
  const matches = html.match(/class="active"/g);
  assert.equal(matches?.length, 1, "exactly one button is active");
});

test("ObscurityTargetPicker marks no button active when target is null", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, { target: null, onTargetChange: () => {} }),
  );
  assert.ok(!html.includes('class="active"'), "no button is active when target is null");
});

test("ObscurityTargetPicker calls onTargetChange with correct value on click", () => {
  const calls = [];
  const element = ObscurityTargetPicker({ target: null, onTargetChange: (v) => calls.push(v) });
  const buttons = element.props.children;
  assert.equal(Array.isArray(buttons), true);
  assert.equal(buttons.length, 3);
  buttons[1].props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "underground");
});
