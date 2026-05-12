/**
 * One JSON shape for service logs (request middleware, pipeline, handlers).
 *
 * @param {"info"|"warn"|"error"} level
 * @param {Record<string, unknown>} fields
 */
function writeStructuredLog(level, fields) {
  const payload = { level, ts: new Date().toISOString(), ...fields };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  writeStructuredLog,
};
