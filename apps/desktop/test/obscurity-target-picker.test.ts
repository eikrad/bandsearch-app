import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObscurityTargetPicker } from "../src/ui/ObscurityTargetPicker.js";

test("ObscurityTargetPicker renders three buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, {
      target: undefined,
      onTargetChange: () => {},
    }),
  );
  assert.ok(html.includes("Cult Following"), "missing Cult Following button");
  assert.ok(html.includes("Underground"), "missing Underground button");
  assert.ok(html.includes("Truly Obscure"), "missing Truly Obscure button");
});

test("ObscurityTargetPicker marks the active target with 'active' class", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, {
      target: "underground",
      onTargetChange: () => {},
    }),
  );
  assert.ok(html.includes("active"), "no button has active class");
  assert.ok(html.includes("Underground"), "Underground button missing");
});

test("ObscurityTargetPicker renders without active class when target is undefined", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObscurityTargetPicker, {
      target: undefined,
      onTargetChange: () => {},
    }),
  );
  assert.ok(!html.includes("active"), "no button should be active when target is undefined");
});
