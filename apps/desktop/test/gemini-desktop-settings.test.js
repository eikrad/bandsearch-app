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
