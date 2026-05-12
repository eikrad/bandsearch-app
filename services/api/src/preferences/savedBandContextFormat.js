/**
 * Single formatting rule for saved-band lines in preference context strings (all storage adapters).
 *
 * @param {{ name: string, rating: number, categories: string[], note: string }} band
 */
function formatSavedBandContextLine(band) {
  return `${band.name} (rating ${band.rating}/5) tags: ${band.categories.join(", ")} note: ${band.note}`;
}

module.exports = {
  formatSavedBandContextLine,
};
