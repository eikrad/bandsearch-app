import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";

import { createDesktopReactMount } from "../src/ui/mountDesktopReactApp.js";
import { fakeContainer, fakeReactRoot, routedViewOf } from "./helpers/fakeDom.js";

/**
 * Renders the settings route and hands back the props the view actually
 * received.
 *
 * Every instance of this bug — the saved-artists screen, the ··· button (#151),
 * account export and deletion (#175) — passed its tests because the view was fed
 * a hand-written prop object while the mount's real handlers were incomplete.
 * The views call handlers with `?.`, so a missing one is silent. Pairing the two
 * is the only arrangement that catches it.
 */
async function renderSettings(
  options: Record<string, unknown> = {},
  viewProps: Record<string, unknown> = {},
) {
  type Rendered = ReactElement<{ viewProps: Record<string, unknown>; handlers: Record<string, unknown> }>;
  let rendered: Rendered | undefined;

  const mount = createDesktopReactMount({
    shell: { getViewProps: () => ({}), updateMode: async () => {}, submitQuery: async () => {} },
    router: { getRoute: () => "settings", navigate: () => {}, onRouteChange: () => {} },
    getSettingsViewProps: async () => ({ headerTitle: "Settings", hasStoredKey: true, ...viewProps }),
    createRootImpl: () => fakeReactRoot((element) => {
      rendered = routedViewOf(element) as Rendered;
    }),
    resolveContainer: () => fakeContainer(),
    ...options,
  } as unknown as Parameters<typeof createDesktopReactMount>[0]);

  await mount.mount();
  if (!rendered) throw new Error("expected the settings screen to render");
  return rendered.props;
}

test("with no collaborator injected, the screen gets no export handler at all", async () => {
  // Not merely "the handler does nothing": absent, so the view omits the button.
  // A present-but-inert handler is what let #175 ship — the view could not tell
  // the difference, so "Export my data" rendered and silently did nothing while
  // the privacy policy pointed users at it for Art. 15 and Art. 20.
  const { handlers } = await renderSettings();

  assert.equal(handlers.onExportAccountData, undefined);
  assert.equal(handlers.onDeleteAccount, undefined);
});

test("with collaborators injected, the screen gets both handlers", async () => {
  const { handlers } = await renderSettings({
    onExportAccountData: async () => ({}),
    onDeleteAccount: async () => ({ ok: true }),
  });

  assert.equal(typeof handlers.onExportAccountData, "function");
  assert.equal(typeof handlers.onDeleteAccount, "function");
});

test("the export handler calls through to the injected collaborator", async () => {
  let asked = 0;
  const { handlers } = await renderSettings({
    onExportAccountData: async () => { asked += 1; return { user: { id: "u1" } }; },
  });

  // The mount wraps the bundle in a Blob download, which needs a DOM the test
  // has no reason to provide; what matters is that the collaborator is reached
  // rather than the handler early-returning on an undefined option.
  await (handlers.onExportAccountData as () => Promise<void>)().catch(() => {});

  assert.equal(asked, 1);
});

test("the delete handler passes the password through", async () => {
  const passwords: string[] = [];
  const { handlers } = await renderSettings({
    onDeleteAccount: async (password: string) => { passwords.push(password); return { ok: true }; },
  });

  await (handlers.onDeleteAccount as (p: string) => Promise<void>)("hunter2");

  assert.deepEqual(passwords, ["hunter2"]);
});

test("the screen is told whether an account exists", async () => {
  // SettingsView renders `!accountsEnabled ? null : dangerZone`, so an unset
  // flag hides account deletion entirely — which is how it shipped.
  const { viewProps } = await renderSettings({}, { accountsEnabled: true });

  assert.equal(viewProps.accountsEnabled, true);
});
