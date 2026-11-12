
/* Kiểm tra THẬT: bấm nút tải trên trang -> trình duyệt nhận file đúng byte.
   Dùng Browser.setDownloadBehavior để ghi file ra đĩa rồi băm SHA-256. */
import { launch, connect, newPage, PROD, sleep } from '../qa/cdp.mjs';
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DL = 'shots/_dl_test';
if (existsSync(DL)) rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const B = await launch({ port: 9334, headless: true, width: 1440, height: 1100 });
const browser = await connect(B.port);

await browser.send('Browser.setDownloadBehavior', {
  behavior: 'allow', downloadPath: process.cwd() + '\\' + DL, eventsEnabled: true,
});

const page = await newPage(browser, { width: 1440, height: 1100 });
await page.goto(PROD + '/#/tai-ve', { waitUntil: 'networkIdle', timeout: 45000 });
await page.waitFor('!!document.querySelector("a.dl-dl")', 20000);
await sleep(1200);

// Bấm đúng thẻ <a download> — giống người dùng thật.
await page.eval(`document.querySelector('a.dl-dl').click()`);

let file = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const files = readdirSync(DL).filter(f => !f.endsWith('.crdownload'));
  if (files.length) { file = files[0]; break; }
}

if (!file) { console.log(JSON.stringify({ ok:false, reason:'no file after 60s', dir: readdirSync(DL) })); process.exit(1); }

const buf = readFileSync(DL + '\\' + file);
const sha = createHash('sha256').update(buf).digest('hex').toUpperCase();
const head = buf.subarray(0, 2).toString('hex');
const isPE = head === '4d5a'; // "MZ"

console.log(JSON.stringify({
  ok: true,
  file,
  bytes: buf.length,
  bytesExpected: 8993792,
  sizeOk: buf.length === 8993792,
  sha256: sha,
  shaOk: sha === 'CF91F953386FEB3FC64B1279C5E4E4748D7A5F610F8A577296FD234D47D89456',
  peMagic: head,
  isWindowsExe: isPE,
}, null, 2));

await page.close(); await B.close();
process.exit(0);
