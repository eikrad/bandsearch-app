import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateBanner } from "../src/ui/UpdateBanner.js";
import { findElement } from "./helpers/fakeDom.js";



test("UpdateBanner renders the available version", () => {
  const html = renderToStaticMarkup(
    React.createElement(UpdateBanner, {
      viewProps: { version: "0.5.0", canAutoInstall: true },
      handlers: {},
    }),
  );
  assert.ok(html.includes("0.5.0"), "expected the version string in the banner");
});

test("UpdateBanner shows an Install button when canAutoInstall is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(UpdateBanner, {
      viewProps: { version: "0.5.0", canAutoInstall: true },
      handlers: {},
    }),
  );
  assert.ok(html.includes("Install"), "expected an Install button");
});

test("UpdateBanner hides the Install button when canAutoInstall is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(UpdateBanner, {
      viewProps: { version: "0.5.0", canAutoInstall: false },
      handlers: {},
    }),
  );
  assert.ok(!html.includes("Install"), "did not expect an Install button");
});

test("UpdateBanner calls the dismiss handler when Later is clicked", () => {
  let dismissed = false;
  const element = UpdateBanner({
    viewProps: { version: "0.5.0", canAutoInstall: true },
    handlers: { onDismiss: () => { dismissed = true; } },
  });
  const laterBtn = findElement(element, (el) => (el.props as { className?: string }).className === "update-banner-dismiss-btn");
  assert.ok(laterBtn, "expected a Later button");
  (laterBtn.props as { onClick?: () => void }).onClick?.();
  assert.equal(dismissed, true);
});

test("UpdateBanner calls the install handler when Install is clicked", () => {
  let installed = false;
  const element = UpdateBanner({
    viewProps: { version: "0.5.0", canAutoInstall: true },
    handlers: { onInstall: () => { installed = true; } },
  });
  const installBtn = findElement(element, (el) => (el.props as { className?: string }).className === "update-banner-install-btn");
  assert.ok(installBtn, "expected an Install button");
  (installBtn.props as { onClick?: () => void }).onClick?.();
  assert.equal(installed, true);
});
