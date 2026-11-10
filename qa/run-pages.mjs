import { launch, connect, newPage, sleep, PROD } from './cdp.mjs';
import { writeFileSync } from 'node:fs';

const ROUTES = [
  ['home', '/#/'],
  ['products', '/#/products'],
  ['products-filter', '/#/products?category=windows-office&sort=price_asc&price=200000-500000'],
  ['product-detail', '/#/product/license-xarena-thang'],
  ['product-missing', '/#/product/khong-ton-tai'],
  ['login', '/#/login'],
  ['register', '/#/register'],
  ['checkout-guest', '/#/checkout'],
  ['wallet-guest', '/#/wallet'],
  ['orders-guest', '/#/orders'],
  ['licenses-guest', '/#/licenses'],
  ['account-guest', '/#/account'],
  ['support', '/#/support'],
  ['admin-guest', '/#/admin'],
  ['404', '/#/khong-ton-tai-trang'],
];

const AUDIT = `(() => {
  const out = { text: '', issues: [] };
  const body = document.body;
  out.text = (body.innerText || '');
  // sentinel strings
  const bads = ['undefined', 'NaN', '[object Object]', 'null%', 'Infinity'];
  for (const b of bads) {
    if (out.text.includes(b)) {
      out.issues.push('TEXT_CONTAINS:' + b);
    }
  }
  // broken images
  out.imgs = [...document.images].map(i => ({
    src: i.currentSrc || i.src, nw: i.naturalWidth, nh: i.naturalHeight,
    alt: i.alt, cls: i.className,
  }));
  out.brokenImgs = out.imgs.filter(i => i.nw === 0 && i.src);
  out.noSrcImgs = out.imgs.filter(i => !i.src);
  // horizontal overflow
  const de = document.documentElement;
  out.scrollW = de.scrollWidth; out.clientW = de.clientWidth;
  out.overflowX = de.scrollWidth - de.clientWidth;
  // offending wide elements
  out.wideEls = [];
  if (out.overflowX > 2) {
    const vw = de.clientWidth;
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
        out.wideEls.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    out.wideEls = out.wideEls.slice(0, 12);
  }
  // small tap targets
  out.smallTaps = [];
  document.querySelectorAll('button, a, input, select, [onclick]').forEach(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0) return;
    if (r.height > 0 && r.height < 44 && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
      out.smallTaps.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,40), txt: (el.innerText||el.value||'').trim().slice(0,24), h: Math.round(r.height), w: Math.round(r.width) });
    }
  });
  // images/task: overlapping checks for header
  out.headerH = document.getElementById('main-header')?.getBoundingClientRect().height || 0;
  out.appChilds = document.getElementById('app')?.children.length ?? -1;
  out.bodyClass = document.body.className;
  out.toasts = document.querySelectorAll('.toast-wrap .toast').length;
  out.modals = document.querySelectorAll('.modal-overlay').length;
  out.hashAfter = location.hash;
  return out;
})()`;

(async () => {
  const b = await launch({ port: 9333 });
  console.log('chrome', b.info.Browser);
  const browser = await connect(b.port);
  const results = [];

  for (const [name, path] of ROUTES) {
    const width = process.env.MOBILE === '1' ? 375 : 1440;
    const height = process.env.MOBILE === '1' ? 812 : 900;
    const page = await newPage(browser, { width, height, mobile: process.env.MOBILE === '1' });
    page.clearLogs();
    try {
      await page.goto(PROD + path, { waitUntil: 'networkIdle' });
      await sleep(1500);
      const a = await page.eval(AUDIT);
      const finalHash = await page.eval('location.hash');
      results.push({
        name, path, requested: path, finalHash,
        errors: page.errors, console: page.logs, httpErrors: page.httpErrors, reqFailed: page.reqFailed,
        audit: a,
      });
      // signals
      const sig = {
        route: name, hash: finalHash,
        jsErrors: page.errors.length,
        consoleErr: page.logs.filter(l => l.type === 'error' || l.type === 'log.error').length,
        brokenImgs: a.brokenImgs.length,
        noSrc: a.noSrcImgs.length,
        overflowX: a.overflowX,
        hashCode: a.issues,
        toasts: a.toasts,
      };
      console.log(JSON.stringify(sig));
      await page.screenshot(`qa/shots/${process.env.MOBILE === '1' ? 'm-' : ''}${name}.png`, { fullPage: true });
    } catch (e) {
      console.log(`!! ${name} FAILED: ${e.message}`);
      results.push({ name, path, fatal: e.message });
    }
    await page.close();
  }

  writeFileSync(`qa/results-${process.env.MOBILE === '1' ? 'mobile' : 'desktop'}.json`, JSON.stringify(results, null, 2));
  await browser.ws.close();
  await b.close();
  console.log('done');
})();
