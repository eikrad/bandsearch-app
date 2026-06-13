const test = require("node:test");
const assert = require("node:assert/strict");

const { createGeminiSettingsController } = require("../src/geminiDesktopSettings");

test("createGeminiSettingsController reports missing key when invoke returns hasStoredKey false", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasStoredKey, false);
});

test("createGeminiSettingsController reports stored key when invoke returns true", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasStoredKey, true);
});

// ── fromEnv flags ──────────────────────────────────────────────────────────

test("getSettingsViewProps passes geminiKeyFromEnv true from invoke", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, geminiKeyFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.geminiKeyFromEnv, true);
});

test("getSettingsViewProps passes braveKeyFromEnv true from invoke", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasBraveKey: true, braveKeyFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.braveKeyFromEnv, true);
});

test("getSettingsViewProps passes tursoFromEnv true from invoke", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasTursoConfig: true, tursoFromEnv: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoFromEnv, true);
});

test("getSettingsViewProps defaults fromEnv flags to false when invoke omits them", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.geminiKeyFromEnv, false);
  assert.equal(props.braveKeyFromEnv, false);
  assert.equal(props.tursoFromEnv, false);
});

// ── Brave API key ──────────────────────────────────────────────────────────

test("createGeminiSettingsController reports hasBraveKey from invoke", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasBraveKey, true);
});

test("createGeminiSettingsController hasBraveKey defaults to false when not returned", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasBraveKey, false);
});

test("createGeminiSettingsController saveBraveApiKey calls save_brave_api_key command", async () => {
  const calls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd, args) => {
      calls.push({ cmd, args });
      return {};
    },
  });
  await ctrl.saveBraveApiKey("bsapikey123");
  const saveCall = calls.find((c) => c.cmd === "save_brave_api_key");
  assert.ok(saveCall, "should call save_brave_api_key");
  assert.equal(saveCall.args.apiKey, "bsapikey123");
});

test("createGeminiSettingsController saveBraveApiKey rejects empty key", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({}),
  });
  await ctrl.saveBraveApiKey("   ");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
});

test("createGeminiSettingsController saveBraveApiKey records error when invoke fails", async () => {
  const ctrl = createGeminiSettingsController({
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

test("createGeminiSettingsController rejects empty save with error status", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({}),
  });
  await ctrl.saveGeminiApiKey("   ");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
});

test("createGeminiSettingsController getBootstrapGate reads onboarding flag from invoke", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false, onboardingComplete: true }),
  });
  const gate = await ctrl.getBootstrapGate();
  assert.deepEqual(gate, { hasStoredKey: false, onboardingComplete: true });
});

test("createGeminiSettingsController completeOnboarding invokes Tauri command", async () => {
  const calls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd) => {
      calls.push(cmd);
      return {};
    },
  });
  await ctrl.completeOnboarding();
  assert.deepEqual(calls, ["complete_onboarding"]);
});

test("createGeminiSettingsController records error when invoke fails on save", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd) => {
      if (cmd === "save_gemini_api_key") throw new Error("disk full");
      return { hasStoredKey: false };
    },
  });
  await ctrl.saveGeminiApiKey("valid-key");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.statusMessage?.type, "error");
  assert.match(props.statusMessage?.text || "", /disk full/);
});

// ── Turso sync settings ────────────────────────────────────────────────────

test("createGeminiSettingsController hasTursoConfig is false when invoke does not return it", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasTursoConfig, false);
});

test("createGeminiSettingsController hasTursoConfig is true when invoke returns it", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: true, hasBraveKey: true, hasTursoConfig: true }),
  });
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.hasTursoConfig, true);
});

test("createGeminiSettingsController saveTursoConfig probes connection before saving", async () => {
  const probeArgs = [];
  const tauriCalls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async (url, token) => { probeArgs.push({ url, token }); return { ok: true }; },
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "mytoken");
  assert.equal(probeArgs.length, 1);
  assert.equal(probeArgs[0].url, "libsql://db.turso.io");
  assert.equal(probeArgs[0].token, "mytoken");
});

test("createGeminiSettingsController saveTursoConfig invokes Tauri when probe succeeds", async () => {
  const tauriCalls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "mytoken");
  const saveCall = tauriCalls.find((c) => c.cmd === "save_turso_config");
  assert.ok(saveCall, "should call save_turso_config");
  assert.equal(saveCall.args.databaseUrl, "libsql://db.turso.io");
  assert.equal(saveCall.args.authToken, "mytoken");
});

test("createGeminiSettingsController saveTursoConfig does NOT invoke Tauri when probe fails", async () => {
  const tauriCalls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd, args) => { tauriCalls.push({ cmd, args }); return {}; },
    probeTursoConnection: async () => ({ ok: false, error: "connection refused" }),
  });
  await ctrl.saveTursoConfig("libsql://bad.turso.io", "badtoken");
  const saveCall = tauriCalls.find((c) => c.cmd === "save_turso_config");
  assert.equal(saveCall, undefined, "should not call save_turso_config when probe fails");
});

test("createGeminiSettingsController saveTursoConfig sets error status when probe fails", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
    probeTursoConnection: async () => ({ ok: false, error: "timeout" }),
  });
  await ctrl.saveTursoConfig("libsql://bad.turso.io", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "error");
  assert.match(props.tursoStatusMessage?.text || "", /timeout/);
});

test("createGeminiSettingsController saveTursoConfig sets success status when probe passes", async () => {
  const ctrl = createGeminiSettingsController({
    invokeTauri: async () => ({ hasStoredKey: false }),
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("libsql://db.turso.io", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "success");
});

test("createGeminiSettingsController saveTursoConfig rejects empty databaseUrl", async () => {
  const tauriCalls = [];
  const ctrl = createGeminiSettingsController({
    invokeTauri: async (cmd) => { tauriCalls.push(cmd); return {}; },
    probeTursoConnection: async () => ({ ok: true }),
  });
  await ctrl.saveTursoConfig("   ", "tok");
  const props = await ctrl.getSettingsViewProps();
  assert.equal(props.tursoStatusMessage?.type, "error");
  assert.equal(tauriCalls.includes("save_turso_config"), false);
});
