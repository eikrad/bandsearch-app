export type ObscurityTier = "mainstream" | "cult" | "underground" | "obscure" | "unknown";

// Listener cut points (Last.fm monthly listeners). A band lands in a tier when
// its listener count is at or above the tier's floor:
//   mainstream : >  500k
//   cult       : 20k – 500k
//   underground: 2k  – 20k
//   obscure    : 0   – 2k
export const OBSCURITY_THRESHOLDS = {
  mainstream: 500000,
  cult: 20000,
  underground: 2000,
} as const;

export function classifyObscurityTier(listeners: number | null | undefined): ObscurityTier {
  if (typeof listeners !== "number" || !Number.isFinite(listeners) || listeners < 0) {
    return "unknown";
  }
  if (listeners > OBSCURITY_THRESHOLDS.mainstream) {
    return "mainstream";
  }
  if (listeners >= OBSCURITY_THRESHOLDS.cult) {
    return "cult";
  }
  if (listeners >= OBSCURITY_THRESHOLDS.underground) {
    return "underground";
  }
  return "obscure";
}
