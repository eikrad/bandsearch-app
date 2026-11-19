/**
 * Hands `data` to the user as a JSON file. Blob plus a temporary link: the
 * Tauri webview allows it and it needs no dependency or IPC command.
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
