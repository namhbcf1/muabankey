
import { launch, connect, newPage, PROD, sleep } from '../qa/cdp.mjs';
import { writeFileSync } from 'node:fs';

const URL = PROD + '/#/tai-ve';

const B = await launch({ port: 9333, headless: true, width: 1440, height: 1200 });
const browser = await connect(B.port);
const page = await newPage(browser, { width: 1440, height: 1200 });

const out = { url: URL };
await page.goto(URL, { waitUntil: 'networkIdle', timeout: 45000 });
await page.waitFor('!!document.querySelector(".dl-hero")', 20000);
await sleep(1500);

// --- 1. Nut tai: ton tai + href + download attr ---
out.btnDownload = await page.eval(`(()=>{
  const a = document.querySelector('a.dl-dl');
  if(!a) return null;
  return { text: a.textContent.trim().replace(/\\s+/g,' '), href: a.getAttribute('href'),
           abs: a.href, download: a.getAttribute('download'),
           visible: a.offsetParent !== null && a.getBoundingClientRect().height > 30 };
})()`);

// --- 2. Hash hien thi ---
out.hashShown = await page.eval(`document.querySelector('[data-dl-hash]')?.textContent?.trim()`);
out.hashLen = (out.hashShown||'').length;
out.hashMatches = out.hashShown === 'CF91F953386FEB3FC64B1279C5E4E4748D7A5F610F8A577296FD234D47D89456';

// --- 3. Version + size ---
out.version = await page.eval(`document.querySelector('[data-dl-version]')?.textContent?.trim()`);
out.size = await page.eval(`document.querySelector('[data-dl-size]')?.textContent?.trim()`);

// --- 4. SmartScreen 3 buoc ---
out.smartScreen = await page.eval(`(()=>{
  const txt = document.body.innerText;
  return {
    moreInfo: txt.includes('More info'),
    runAnyway: txt.includes('Run anyway'),
    yes: /\\bYes\\b/.test(txt),
    warnAlert: !!document.querySelector('.alert-warn'),
    warnBelowBtn: (()=>{
      const a=document.querySelector('a.dl-dl'); const w=document.querySelector('.alert-warn');
      if(!a||!w) return null;
      return w.getBoundingClientRect().top > a.getBoundingClientRect().bottom;
    })(),
    guideLink: !!document.querySelector('.alert-warn ~ .panel a[href="#/huong-dan"], a[href="#/huong-dan"]'),
  };
})()`);

// --- 5. Disclaimer ---
out.disclaimer = await page.eval(`(()=>{
  const t = document.body.innerText;
  return {
    onlyFrom: t.includes('Chỉ tải file từ xienhl.com') || t.includes('Chỉ tải từ'),
    noZalo: /Zalo/.test(t) && /Messenger/.test(t),
    drive: /Google Drive/.test(t),
    deleteNow: /XOÁ NGAY/.test(t),
  };
})()`);

// --- 6. certutil command ---
out.certutil = await page.eval(`document.querySelector('.dl-cmd code')?.textContent?.trim()`);

// --- 7. 3 buoc dung tool ---
out.threeSteps = await page.eval(`(()=>{
  const t=document.body.innerText;
  return { tai: /Tải về/.test(t), dbl: /Double-click/.test(t), trial: /3 ngày/.test(t) };
})()`);

// --- 8. Yeu cau he thong ---
out.sysReq = await page.eval(`(()=>{
  const t=document.body.innerText;
  return { win1011: /Windows 10 \\/ 11/.test(t), win7: /Windows 7/.test(t) && /Không hỗ trợ/.test(t),
           ram: /RAM/.test(t), admin: /Administrator/.test(t) };
})()`);

// --- 9. Link mua key ---
out.buyLink = await page.eval(`(()=>{
  const a=document.querySelector('a[href*="license-xarena"]');
  return a? {href:a.getAttribute('href'), text:a.textContent.trim()} : null;
})()`);

// --- 10. Public: khong bi day ve /login ---
out.publicOk = await page.eval(`!location.hash.startsWith('#/login')`);

// --- 11. Khong loi console/network ---
out.errors = page.errors;
out.httpErrors = page.httpErrors;

// --- 12. Nut Copy bam duoc ---
out.copyClick = await page.eval(`(async()=>{
  const b=document.querySelector('[data-dl-copy-hash]');
  if(!b) return 'no-btn';
  b.click(); await new Promise(r=>setTimeout(r,600));
  const toast=document.querySelector('.toast-wrap .toast');
  return toast ? toast.textContent.trim() : 'no-toast';
})()`);

// --- 13. Nav link ---
out.navLink = await page.eval(`(()=>{const a=document.querySelector('.nav a[href="#/tai-ve"]');return a?a.textContent.trim():null})()`);
out.footerLink = await page.eval(`(()=>{const a=document.querySelector('footer a[href="#/tai-ve"]');return a?a.textContent.trim():null})()`);

// --- Screenshot desktop full page ---
await L(1000);
await page.screenshot('shots/E0-download-page.png', { fullPage: true });
console.log('saved desktop');

// --- Mobile screenshot ---
const m = await newPage(browser, { width: 390, height: 844, mobile: true });
await m.goto(URL, { waitUntil: 'networkIdle', timeout: 45000 });
await m.waitFor('!!document.querySelector(".dl-hero")', 20000);
await L(1500);
await m.screenshot('shots/E0-download-page-mobile.png', { fullPage: true });

out.mobileOverflow = await m.eval(`(()=>{
  const de=document.documentElement;
  const bad=[...document.querySelectorAll('.dl-wrap *')].filter(el=>{
    const r=el.getBoundingClientRect();
    return r.width>0 && r.right > de.clientWidth + 1;
  }).slice(0,6).map(el=>el.className||el.tagName);
  return { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowing: bad };
})()`);
out.mobileErrors = m.errors;

function L(ms){return new Promise(r=>setTimeout(r,ms));}

writeFileSync('shots/E0-results.json', JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));

await m.close(); await page.close(); await B.close();
process.exit(0);
