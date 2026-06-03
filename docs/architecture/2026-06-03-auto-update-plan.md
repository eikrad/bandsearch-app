# Auto-Update Plan (Phase 10)

**Datum:** 2026-06-03  
**Ziel:** Tester sehen in der App sofort wenn eine neue Version verfügbar ist und können auf Windows/Linux per Klick aktualisieren. macOS bekommt einen Banner mit Download-Link.

---

## Ansatz

Event-getrieben: Rust prüft beim Start still im Hintergrund auf Updates (kein Polling). Bei Fund emittiert es ein Tauri-Event mit Versions-Info und einem Flag `canAutoInstall`. Das Frontend zeigt einen schmalen Banner — ohne extra Controller-Datei.

**Plattform-Strategie:**
- **Windows & Linux:** `tauri-plugin-updater` — vollautomatisch, ein Klick installiert und neustartet
- **macOS:** Kein Code-Signing → Rust-seitiger Updater liefert kein Ergebnis (kein macOS-Eintrag in `latest.json`); stattdessen Frontend-seitiger GitHub-API-Check → Banner mit Link zur Releases-Seite

---

## Dateien & Änderungen

### `apps/desktop/src-tauri/Cargo.toml`
- `tauri-plugin-updater = "2"` hinzufügen
- Version von `"0.2.0"` auf `"0.4.0"` setzen (sync mit npm-Packages)

### `apps/desktop/src-tauri/tauri.conf.json`
- Version auf `"0.4.0"` setzen
- Updater-Plugin-Block ergänzen:
  ```json
  "plugins": {
    "updater": {
      "pubkey": "<PUBLIC_KEY>",
      "endpoints": [
        "https://github.com/eikrad/bandsearch-app/releases/latest/download/latest.json"
      ],
      "windows": { "installMode": "passive" }
    }
  }
  ```

### `apps/desktop/src-tauri/capabilities/default.json`
- `"allow-install-update"` zu den Permissions hinzufügen

### `apps/desktop/src-tauri/src/main.rs`
1. `tauri_plugin_updater::UpdaterExt` importieren
2. `.plugin(tauri_plugin_updater::Builder::new().build())` im Builder registrieren
3. Hintergrund-Check im `.setup()`-Hook (nach `app.manage()`):
   ```rust
   let handle = app.handle().clone();
   tauri::async_runtime::spawn(async move {
       if let Ok(updater) = handle.updater() {
           if let Ok(Some(update)) = updater.check().await {
               let can_auto_install = cfg!(not(target_os = "macos"));
               let _ = handle.emit("update-available", serde_json::json!({
                   "version": update.version.to_string(),
                   "canAutoInstall": can_auto_install,
               }));
           }
       }
   });
   ```
4. Neuer Command `install_update` (check + install in einem, kein State nötig):
   ```rust
   #[tauri::command]
   async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
       let updater = app.updater().map_err(|e| e.to_string())?;
       if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
           update.download_and_install(|_, _| {}, || {}).await
               .map_err(|e| e.to_string())?;
       }
       Ok(())
   }
   ```
5. `install_update` in `generate_handler![...]` eintragen

### `apps/desktop/src/startDesktopBrowserApp.ts`
Kein neues File. Am Ende der `startDesktopBrowserApp`-Funktion (nach `reactApp.mount()`):

**A) Windows/Linux — Tauri-Event-Listener:**
```typescript
try {
  const { listen } = require("@tauri-apps/api/event") as {
    listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<unknown>
  };
  listen<{ version: string; canAutoInstall: boolean }>(
    "update-available",
    ({ payload }) => showUpdateBanner(payload.version, payload.canAutoInstall)
  );
} catch { /* nicht in Tauri */ }
```

**B) macOS — GitHub-API-Check:**
```typescript
if (navigator.userAgent.includes("Mac")) {
  void checkMacosUpdate();
}

async function checkMacosUpdate() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/eikrad/bandsearch-app/releases/latest"
    );
    const { tag_name } = await res.json() as { tag_name: string };
    const latestVersion = tag_name.replace(/^v/, "");
    const { getVersion } = await import("@tauri-apps/api/app");
    const currentVersion = await getVersion();
    if (latestVersion !== currentVersion) {
      showUpdateBanner(latestVersion, false);
    }
  } catch { /* still: silently */ }
}
```

**Banner (inline, beide Pfade):**
```typescript
function showUpdateBanner(version: string, canAutoInstall: boolean): void {
  const banner = document.createElement("div");
  Object.assign(banner.style, {
    position: "fixed", top: "0", left: "0", right: "0",
    background: "#1e293b", borderBottom: "1px solid #334155",
    color: "#e2e8f0", padding: "10px 20px",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    zIndex: "9999",
  });
  const action = canAutoInstall
    ? `<button id="bs-btn-install" style="margin-right:8px;cursor:pointer">Jetzt installieren</button>`
    : `<a href="https://github.com/eikrad/bandsearch-app/releases/latest"
          target="_blank" style="color:#94a3b8;margin-right:8px">Herunterladen</a>`;
  banner.innerHTML = `
    <span>Version ${version} verfügbar</span>
    <div>${action}<button id="bs-btn-dismiss" style="cursor:pointer">Später</button></div>
  `;
  document.body.prepend(banner);
  document.getElementById("bs-btn-install")?.addEventListener("click", () => {
    try {
      const { invoke } = require("@tauri-apps/api/core") as { invoke: (cmd: string) => Promise<unknown> };
      void invoke("install_update");
    } catch { /* */ }
  });
  document.getElementById("bs-btn-dismiss")?.addEventListener("click", () => banner.remove());
}
```

### `.github/workflows/release.yml` (neu)
Trigger: `push` auf Tags `v*`. Drei parallele Jobs (Linux, Windows, macOS) mit plattform-spezifischen Steps — kein fragiler Bash-Conditional, PowerShell für Windows.

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: dtolnay/rust-toolchain@stable

      - name: Linux system deps
        if: runner.os == 'Linux'
        run: sudo apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev patchelf

      - name: Node sidecar (Linux)
        if: runner.os == 'Linux'
        run: |
          curl -fsSL https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.gz | tar xz
          cp node-v22.16.0-linux-x64/bin/node \
             apps/desktop/src-tauri/binaries/node-x86_64-unknown-linux-gnu
          chmod +x apps/desktop/src-tauri/binaries/node-x86_64-unknown-linux-gnu

      - name: Node sidecar (macOS ARM)
        if: runner.os == 'macOS'
        run: |
          curl -fsSL https://nodejs.org/dist/v22.16.0/node-v22.16.0-darwin-arm64.tar.gz | tar xz
          cp node-v22.16.0-darwin-arm64/bin/node \
             apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin
          chmod +x apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin

      - name: Node sidecar (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          Invoke-WebRequest https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip -OutFile node.zip
          Expand-Archive node.zip -DestinationPath .
          Copy-Item node-v22.16.0-win-x64\node.exe `
            apps\desktop\src-tauri\binaries\node-x86_64-pc-windows-msvc.exe

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Bandsearch ${{ github.ref_name }}'
          releaseDraft: true
          prerelease: true
```

---

## Einmaliger Setup (lokal, vor erstem Release)

```bash
npx tauri signer generate -w ~/.tauri/bandsearch.key
# → Public Key ausgeben → in tauri.conf.json unter "pubkey" eintragen + committen
# → Private Key → als GitHub Secret TAURI_SIGNING_PRIVATE_KEY speichern
# → Passwort (leer ok) → als TAURI_SIGNING_PRIVATE_KEY_PASSWORD speichern
```

macOS-Tester müssen beim allerersten Start Gatekeeper manuell umgehen (rechtsklick → Öffnen). Bei Beta-Tests akzeptabel.

---

## Verifikation

1. `cargo check` im `src-tauri/` — keine Compile-Fehler
2. `tauri dev` — Version 0.4.0, kein Startfehler
3. Tag `v0.4.0` pushen → alle drei CI-Jobs laufen durch → GitHub Release Draft mit `.msi`, `.deb`/`.AppImage`, `.dmg` und `latest.json`
4. **Win/Linux:** App mit Version `0.3.9` starten → Banner erscheint → "Installieren" startet passiven Update-Prozess
5. **macOS:** Gleiche Versionsdifferenz → GitHub-API-Check erkennt Update → Banner mit Download-Link erscheint
