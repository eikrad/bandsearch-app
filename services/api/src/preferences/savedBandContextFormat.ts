export type SavedBandForFormat = {
  name: string;
  rating: number;
  categories: string[];
  note: string;
};

export function formatSavedBandContextLine(band: SavedBandForFormat): string {
  return `${band.name} (rating ${band.rating}/5) tags: ${band.categories.join(", ")} note: ${band.note}`;
}
