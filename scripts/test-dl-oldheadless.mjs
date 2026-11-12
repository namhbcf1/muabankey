
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, Session, sleep } from '../qa/cdp.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DL = process.cwd() + '\\shots\\_dl_exe';
if (existsSync(DL)) rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'dl-chrome-'));
const port = 9336;
const proc = spawn(CHROME, [
  '--headless=old',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1440,1100',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let info = null;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { info = await r.json(); break; } } catch {}
  await sleep(150);
}
if (!info) { console.log(JSON.stringify({ ok:false, reason:'chrome (old headless) did not start' })); proc.kill(); process.exit(1); }

const browser = await connect(port);
await browser.send('Browser.setDownloadBehavior', {
  behavior: 'allow', downloadPath: DL, eventsEnabled: true,
});

const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => browser.send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');

const events = [];
browser.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.downloadWillBegin') events.push({ ev:'begin', url:m.params.url });
  if (m.method === 'Page.downloadProgress') events.push({ ev:'prog', state:m.params.state });
  if (m.method === 'Browser.downloadProgress') events.push({ ev:'bprog', state:m.params.state, got:m.params.receivedBytes, total:m.params.totalBytes });
});

await S('Page.navigate', { url: 'https://xienhl.com/#/tai-ve' });
await sleep(6000);

// Bam nut tai that
const r = await S('Runtime.evaluate', {
  expression: `(()=>{const a=document.querySelector('a.dl-dl'); if(!a) return 'NO-BTN'; a.click(); return a.getAttribute('href');})()`,
  returnByValue: true, userGesture: true,
});
console.log('clicked href =', r.result.value);

let file = null;
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  const files = readdirSync(DL).filter(f => !f.endsWith('.crdownload'));
  if (files.length) { file = files[0]; break; }
}

const out = { events: events.slice(-12), dir: readdirSync(DL) };
if (file) {
  const buf = readFileSync(join(DL, file));
  const sha = createHash('sha256').update(buf).digest('hex').toUpperCase();
  Object.assign(out, {
    ok: true, file, bytes: buf.length,
    sizeOk: buf.length === 8993792,
    sha256: sha,
    shaOk: sha === 'CF91F953386FEB3FC64B1279C5E4E4748D7A5F610F8A577296FD234D47D89456',
    peMagic: buf.subarray(0,2).toString('hex'),
  });
} else { out.ok = false; out.reason = 'no file'; }

console.log(JSON.stringify(out, null, 2));
try { proc.kill(); } catch {}
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
