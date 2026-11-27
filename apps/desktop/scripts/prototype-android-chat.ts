/** Build a self-contained #335 prototype (on the #334 harness); --phone loads it into the existing debug APK.
 * No server, APK update, credentials, storage writes or real API requests.
 */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

async function main() {
  const output = '/tmp/bandsearch-android-note-prototype.html';
  const built = await build({ entryPoints: ['apps/desktop/src/ui/AndroidChatPrototype.ts'], bundle: true, write: false, minify: true, platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
  const css = await readFile('apps/desktop/public/styles.css', 'utf8') + '\n' + await readFile('apps/desktop/src/ui/AndroidChatPrototype.css', 'utf8');
  const js = built.outputFiles[0]!.text.replaceAll('</script', '<\\/script');
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Bandsearch · prototype 335</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  await writeFile(output, html);
  console.log(output);
  if (!process.argv.includes('--phone')) return;
  const adb = process.env.ADB ?? path.join(os.homedir(), 'Android/Sdk/platform-tools/adb');
  execFileSync(adb, ['shell', 'am', 'start', '-n', 'app.bandsearch/.MainActivity']);
  const pid = execFileSync(adb, ['shell', 'pidof', 'app.bandsearch'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(pid)) throw new Error('Open the installed Bandsearch debug app first.');
  const port = execFileSync(adb, ['forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`], { encoding: 'utf8' }).trim();
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as { url: string; title: string; webSocketDebuggerUrl?: string }[];
    const page = pages.find(p => p.url.startsWith('https://tauri.localhost') || (p.url.startsWith('about:blank') && p.title === 'Bandsearch · prototype 335'));
    if (!page?.webSocketDebuggerUrl) throw new Error('Bandsearch debug WebView not available.');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('WebView connection failed')); });
    let id = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const key = ++id;
      return new Promise((resolve, reject) => { pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
    }
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { requestId: string } };
      if (message.id) {
        const entry = pending.get(message.id); pending.delete(message.id);
        if (message.error) entry?.reject(new Error(message.error.message)); else entry?.resolve(message.result);
      }
    };
    try {
      // Tauri's intercepted local assets bypass CDP Fetch. Start a fresh document
      // so none of the installed app's timers/listeners survives into the sample.
      await send('Page.navigate', { url: 'about:blank' });
      const tree = await send('Page.getFrameTree') as { frameTree: { frame: { id: string } } };
      await send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
      const ready = await send('Runtime.evaluate', { expression: "document.title", returnByValue: true }) as { result: { value?: string } };
      if (ready.result.value !== 'Bandsearch · prototype 335') throw new Error('Prototype document did not load');
      console.log('Prototype loaded on the phone. A/B/C switcher is at the bottom. Restart the app to exit.');
    } finally { ws.close(); }
  } finally { execFileSync(adb, ['forward', '--remove', `tcp:${port}`]); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
