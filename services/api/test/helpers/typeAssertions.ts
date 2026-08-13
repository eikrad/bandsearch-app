export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object");
  }
}

export function assertArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected an array");
  }
}
