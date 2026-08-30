import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateBanner } from "../src/ui/UpdateBanner.js";

type ButtonElement = React.ReactElement<{
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}>;

/**
 * UpdateBanner has no internal state, so it is called directly (not mounted)
 * and its returned element tree is walked to find the button to click — the
 * only way to exercise a click handler without a DOM/testing-library setup,
 * which this codebase does not have.
 */
function findByClassName(node: unknown, className: string): ButtonElement | null {
  if (!node || typeof node !== "object") return null;
  const el = node as ButtonElement;
  if (el.props?.className === className) return el;
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByClassName(child, className);
      if (found) return found;
    }
  } else if (children) {
    return findByClassName(children, className);
  }
  return null;
}

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
  const laterBtn = findByClassName(element, "update-banner-dismiss-btn");
  assert.ok(laterBtn, "expected a Later button");
  laterBtn!.props.onClick?.();
  assert.equal(dismissed, true);
});

test("UpdateBanner calls the install handler when Install is clicked", () => {
  let installed = false;
  const element = UpdateBanner({
    viewProps: { version: "0.5.0", canAutoInstall: true },
    handlers: { onInstall: () => { installed = true; } },
  });
  const installBtn = findByClassName(element, "update-banner-install-btn");
  assert.ok(installBtn, "expected an Install button");
  installBtn!.props.onClick?.();
  assert.equal(installed, true);
});
