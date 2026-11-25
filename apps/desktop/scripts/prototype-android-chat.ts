/** Build a self-contained #334 prototype; --phone loads it into the existing debug APK.
 * No server, APK update, credentials, storage writes or real API requests.
 */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

async function main() {
  const output = '/tmp/bandsearch-android-chat-prototype.html';
  const built = await build({ entryPoints: ['apps/desktop/src/ui/AndroidChatPrototype.ts'], bundle: true, write: false, minify: true, platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
  const css = await readFile('apps/desktop/public/styles.css', 'utf8') + '\n' + await readFile('apps/desktop/src/ui/AndroidChatPrototype.css', 'utf8');
  const js = built.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Bandsearch · prototype 334</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  await writeFile(output, html);
  console.log(output);
  if (!process.argv.includes('--phone')) return;
  const adb = process.env.ADB ?? path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
  execFileSync(adb, ['shell', 'am', 'start', '-n', 'app.bandsearch/.MainActivity']);
  const pid = execFileSync(adb, ['shell', 'pidof', 'app.bandsearch'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(pid)) throw new Error('Open the installed Bandsearch debug app first.');
  const port = execFileSync(adb, ['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`], { encoding: 'utf8' }).trim();
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { url: string; webSocketDebuggerUrl?: string }[];
    const page = pages.find(p => p.url.startsWith('https://tauri.localhost'));
    if (!page?.webSocketDebuggerUrl) throw new Error('Bandsearch debug WebView not available.');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('WebView connection failed')); });
    let id = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const key = ++id;
      return new Promise((resolve, reject) => { pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
    }
    let loaded!: () => void;
    const loadedPromise = new Promise<void>(resolve => { loaded = resolve; });
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { requestId: string } };
      if (message.id) {
        const entry = pending.get(message.id); pending.delete(message.id);
        if (message.error) entry?.reject(new Error(message.error.message)); else entry?.resolve(message.result);
      }
      if (message.method === 'Fetch.requestPaused' && message.params) {
        void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(html).toString('base64') }).then(loaded);
      }
    };
    try {
      await send('Fetch.enable', { patterns: [{ urlPattern: '*tauri.localhost/*prototype=android-chat*', resourceType: 'Document', requestStage: 'Request' }] });
      const navigating = send('Page.navigate', { url: 'https://tauri.localhost/?prototype=android-chat&variant=A#/chat' });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all([loadedPromise, navigating]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out loading the prototype in the WebView')), 15000); })]);
      } finally { clearTimeout(timer); }
      await send('Fetch.disable');
      console.log('Prototype loaded on the phone. A/B/C switcher is at the bottom. Restart the app to exit.');
    } finally { ws.close(); }
  } finally { execFileSync(adb, ['forward', '--remove', `tcp:${port}`]); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
