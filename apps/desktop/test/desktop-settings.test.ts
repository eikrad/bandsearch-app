import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopSettingsController } from "../src/desktopSettings.js";

type TauriCall = { cmd: string; args?: Record<string, string> };

test("createDesktopSettingsController reports missing key when invoke returns hasStoredKey false", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasStoredKey, false);
});

test("createDesktopSettingsController reports stored key when invoke returns true", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasStoredKey, true);
});

// ── fromEnv flags ──────────────────────────────────────────────────────────

test("getSettingsViewProps passes llmKeyFromEnv true from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, llmKeyFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.llmKeyFromEnv, true);
});

test("getSettingsViewProps passes braveKeyFromEnv true from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasBraveKey: true, braveKeyFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.braveKeyFromEnv, true);
});

test("getSettingsViewProps passes tursoFromEnv true from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasTursoConfig: true, tursoFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoFromEnv, true);
});

test("getSettingsViewProps defaults fromEnv flags to false when invoke omits them", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.llmKeyFromEnv, false);
  assert.equal(props.braveKeyFromEnv, false);
  assert.equal(props.tursoFromEnv, false);
});

// ── Brave API key ──────────────────────────────────────────────────────────

test("createDesktopSettingsController reports hasBraveKey from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasBraveKey, true);
});

test("createDesktopSettingsController hasBraveKey defaults to false when not returned", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasBraveKey, false);
});

test("createDesktopSettingsController saveBraveApiKey calls save_brave_api_key command", async () => {
  const calls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => {
      calls.push({ cmd, args });
      return {};
    },
  });
  await ctrl.saveBraveApiKey("bsapikey123");
  const saveCall = calls.find((c) => c.cmd === "save_brave_api_key");
  assert.ok(saveCall, "should call save_brave_api_key");
  assert.equal(saveCall.args?.apiKey, "bsapikey123");
});

test("createDesktopSettingsController saveBraveApiKey rejects empty key", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({}),
  });
  await ctrl.saveBraveApiKey("   ");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
});

test("createDesktopSettingsController saveBraveApiKey records error when invoke fails", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "save_brave_api_key") throw new Error("permission denied");
      return { hasStoredKey: false };
    },
  });
  await ctrl.saveBraveApiKey("my-brave-key");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
  assert.match(props.statusMessage?.text || "", /permission denied/);
});

test("createDesktopSettingsController rejects empty save with error status", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({}),
  });
  await ctrl.saveLlmApiKey("   ");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
});

test("createDesktopSettingsController getBootstrapGate reads onboarding flag from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false, onboardingComplete: true }),
  });
  const gate = await ctrl.getBootstrapGate();
  assert.deepEqual(gate, { hasStoredKey: false, onboardingComplete: true, apiEndpointUrl: "" });
});

test("createDesktopSettingsController completeOnboarding invokes Tauri command", async () => {
  const calls: string[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      calls.push(cmd);
      return {};
    },
  });
  await ctrl.completeOnboarding();
  assert.deepEqual(calls, ["complete_onboarding"]);
});

test("createDesktopSettingsController records error when invoke fails on save", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "save_llm_api_key") throw new Error("disk full");
      return { hasStoredKey: false };
    },
  });
  await ctrl.saveLlmApiKey("valid-key");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
  assert.match(props.statusMessage?.text || "", /disk full/);
});

// ── Turso sync settings ────────────────────────────────────────────────────

test("createDesktopSettingsController hasTursoConfig is false when invoke does not return it", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasTursoConfig, false);
});

test("createDesktopSettingsController hasTursoConfig is true when invoke returns it", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true, hasTursoConfig: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasTursoConfig, true);
});

test("createDesktopSettingsController saveTursoConfig probes connection before saving", async () => {
  const probeArgs: Array<{ url: string; token: string }> = [];
  const tauriCalls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async (url, token) => { probeArgs.push({ url, token }); return { ok: true }; },
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "mytoken");
  assert.equal(probeArgs.length, 1);
  assert.equal(probeArgs[0].url, "libsql://db.turso.io");
  assert.equal(probeArgs[0].token, "mytoken");
});

test("createDesktopSettingsController saveTursoConfig invokes Tauri when probe succeeds", async () => {
  const tauriCalls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "mytoken");
  const saveCall = tauriCalls.find((c) => c.cmd === "save_turso_config");
  assert.ok(saveCall, "should call save_turso_config");
  assert.equal(saveCall.args?.databaseUrl, "libsql://db.turso.io");
  assert.equal(saveCall.args?.authToken, "mytoken");
});

test("createDesktopSettingsController saveTursoConfig does NOT invoke Tauri when probe fails", async () => {
  const tauriCalls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async () => ({ ok: false, error: "connection refused" }),
  });
  await ctrl.saveTursoConfig("libsql://bad.turso.io", "badtoken");
  const saveCall = tauriCalls.find((c) => c.cmd === "save_turso_config");
  assert.equal(saveCall, undefined, "should not call save_turso_config when probe fails");
});

test("createDesktopSettingsController saveTursoConfig sets error status when probe fails", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
    probeTursoConnection: async () => ({ ok: false, error: "timeout" }),
  });
  await ctrl.saveTursoConfig("libsql://bad.turso.io", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "error");
  assert.match(props.tursoStatusMessage?.text || "", /timeout/);
});

test("createDesktopSettingsController saveTursoConfig sets success status when probe passes", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "success");
});

test("createDesktopSettingsController saveTursoConfig rejects empty databaseUrl", async () => {
  const tauriCalls: string[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => { tauriCalls.push(cmd); return {}; },
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("   ", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "error");
  assert.equal(tauriCalls.includes("save_turso_config"), false);
});

// ── API endpoint (remote vs local sidecar) ───────────────────────────────────

test("getSettingsViewProps passes apiEndpointUrl from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, apiEndpointUrl: "https://bandsearch-api.onrender.com" }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointUrl, "https://bandsearch-api.onrender.com");
});

test("getSettingsViewProps apiEndpointUrl defaults to empty string when invoke omits it", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointUrl, "");
});

test("getBootstrapGate includes apiEndpointUrl from invoke", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, onboardingComplete: true, apiEndpointUrl: "https://remote.example" }),
  });
  const gate = await ctrl.getBootstrapGate();
  assert.equal(gate.apiEndpointUrl, "https://remote.example");
});

test("saveApiEndpointUrl calls save_api_endpoint_url with trimmed url", async () => {
  const calls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => { calls.push({ cmd, args }); return {}; },
  });
  await ctrl.saveApiEndpointUrl("  https://bandsearch-api.onrender.com  ");
  const saveCall = calls.find((c) => c.cmd === "save_api_endpoint_url");
  assert.ok(saveCall, "should call save_api_endpoint_url");
  assert.equal(saveCall.args?.url, "https://bandsearch-api.onrender.com");
});

test("saveApiEndpointUrl accepts empty string to reset to local and reports success", async () => {
  const calls: TauriCall[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd, args) => { calls.push({ cmd, args }); return {}; },
  });
  await ctrl.saveApiEndpointUrl("   ");
  const saveCall = calls.find((c) => c.cmd === "save_api_endpoint_url");
  assert.ok(saveCall, "should call save_api_endpoint_url with empty url");
  assert.equal(saveCall.args?.url, "");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointStatusMessage?.type, "success");
});

test("saveApiEndpointUrl rejects a non-URL value without invoking", async () => {
  const calls: string[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => { calls.push(cmd); return {}; },
  });
  await ctrl.saveApiEndpointUrl("bandsearch-api.onrender.com");
  assert.equal(calls.includes("save_api_endpoint_url"), false, "should not invoke for a malformed URL");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointStatusMessage?.type, "error");
});

test("saveApiEndpointUrl rejects a non-http protocol without invoking", async () => {
  const calls: string[] = [];
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => { calls.push(cmd); return {}; },
  });
  await ctrl.saveApiEndpointUrl("javascript:alert(1)");
  assert.equal(calls.includes("save_api_endpoint_url"), false, "should not invoke for a non-http protocol");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointStatusMessage?.type, "error");
});

test("saveApiEndpointUrl records error when invoke fails", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "save_api_endpoint_url") throw new Error("disk full");
      return { hasStoredKey: false };
    },
  });
  await ctrl.saveApiEndpointUrl("https://remote.example");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.apiEndpointStatusMessage?.type, "error");
  assert.match(props.apiEndpointStatusMessage?.text || "", /disk full/);
});

test("llm_config_status is invoked exactly once per getSettingsViewProps call", async () => {
  let callCount = 0;
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "llm_config_status") callCount++;
      return { hasStoredKey: true };
    },
  });
  callCount = 0;
  await ctrl.getSettingsViewProps();
  assert.equal(callCount, 1, "invokeTauri should be called exactly once");
});

test("llm_config_status is invoked exactly once per getBootstrapGate call", async () => {
  let callCount = 0;
  const ctrl = createDesktopSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "llm_config_status") callCount++;
      return { hasStoredKey: false };
    },
  });
  callCount = 0;
  await ctrl.getBootstrapGate();
  assert.equal(callCount, 1, "invokeTauri should be called exactly once");
});

// The browser build bundles @tauri-apps/api, so `invokeTauri` is a function even
// in a plain browser — the call is what fails, not the import. Treating a failed
// invoke as "no config" instead of "not Tauri" left the documented browser-dev
// localStorage fallback unreachable, and the app stuck on the welcome screen.
function withStubbedLocalStorage<T>(entries: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as { localStorage?: Storage };
  const previous = globals.localStorage;
  globals.localStorage = {
    getItem: (key: string) => entries[key] ?? null,
    setItem: () => {},
    removeItem: () => {},
  } as unknown as Storage;
  return run().finally(() => {
    if (previous === undefined) delete globals.localStorage;
    else globals.localStorage = previous;
  });
}

test("bootstrap gate falls back to browser storage when the Tauri invoke fails", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => { throw new Error("not running in Tauri"); },
  });

  const gate = await withStubbedLocalStorage(
    { bandsearch_onboarding_complete: "1", bandsearch_llm_api_key: "key-123" },
    () => ctrl.getBootstrapGate(),
  );

  assert.equal(gate.onboardingComplete, true);
  assert.equal(gate.hasStoredKey, true);
});

test("settings view falls back to browser storage when the Tauri invoke fails", async () => {
  const ctrl = createDesktopSettingsController({
    invokeTauri: async () => { throw new Error("not running in Tauri"); },
  });

  const props = await withStubbedLocalStorage(
    { bandsearch_llm_api_key: "key-123", bandsearch_brave_api_key: "brave-456" },
    () => ctrl.getSettingsViewProps(),
  );

  assert.equal(props.hasStoredKey, true);
  assert.equal(props.hasBraveKey, true);
});
