const { Pool } = require("pg");
const { createInMemoryPreferenceRepository } = require("./preferenceMemory");
const { createPostgresPreferenceRepository } = require("./postgresPreferenceRepository");

/**
 * PreferenceRepository contract (storage abstraction):
 * - addSavedBand(input)
 * - listSavedBands()
 * - updateSavedBand(id, updates)
 * - deleteSavedBand(id)
 * - buildContext()
 */
function assertPreferenceRepository(repository) {
  const requiredMethods = [
    "addSavedBand",
    "listSavedBands",
    "updateSavedBand",
    "deleteSavedBand",
    "buildContext",
  ];

  for (const methodName of requiredMethods) {
    if (typeof repository?.[methodName] !== "function") {
      throw new Error(`invalid preference repository: missing method ${methodName}`);
    }
  }

  return repository;
}

function createPreferenceRepository(runtimeConfig = {}) {
  if (runtimeConfig.preferenceStore === "postgres") {
    const pool = new Pool({
      connectionString: runtimeConfig.databaseUrl,
      ssl: runtimeConfig.databaseSsl ? { rejectUnauthorized: false } : undefined,
    });
    return createPostgresPreferenceRepository({ pool });
  }
  return createInMemoryPreferenceRepository();
}

module.exports = {
  assertPreferenceRepository,
  createPreferenceRepository,
};
