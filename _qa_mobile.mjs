import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9406, headless: true, width: 390, height: 844 });
const s = await connect(b.port);
const p = await newPage(s, { width: 390, height: 844, mobile: true });

const routes = [
  ['#/', 'home'],
  ['#/products', 'products'],
  ['#/product/license-xarena-thang', 'product'],
  ['#/login', 'login'],
  ['#/register', 'register'],
  ['#/support', 'support'],
  ['#/khong-ton-tai', '404'],
];

console.log('=== MOBILE 390x844 ===');
for (const [h, name] of routes) {
  p.clearLogs();
  await p.goto(PROD + '/' + h);
  await sleep(2400);
  const info = await p.eval(`(() => {
    const de = document.documentElement;
    const cw = de.clientWidth;
    const overflow = de.scrollWidth > cw + 2;
    const wide = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width > 0 && r.right > cw + 8 && cs.position !== 'fixed' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
        wide.push({ tag: el.tagName, cls: String(el.className||'').slice(0,40), right: Math.round(r.right), w: Math.round(r.width) });
      }
    });
    // font check: look for mojibake
    const t = document.body.innerText;
    const moj = (t.match(/[ÃÂÄ][\\u0080-\\u00BF¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿]/g)||[]).slice(0,6);
    const qmarks = (t.match(/\\uFFFD/g)||[]).length;
    // tap target size check
    const small = [];
    document.querySelectorAll('button, a.btn, [role=button]').forEach(el=>{
      const r = el.getBoundingClientRect();
      if (r.width>0 && r.height>0 && (r.height < 40)) small.push({ txt: el.textContent.trim().slice(0,22), h: Math.round(r.height), w: Math.round(r.width) });
    });
    return { cw, scrollW: de.scrollWidth, overflow, wideCount: wide.length, wideSample: wide.slice(0,5),
      mojibake: moj, replacementChars: qmarks, smallTaps: small.slice(0,5), smallTapCount: small.length };
  })()`).catch(e => ({ err: String(e) }));
  console.log(JSON.stringify({ name, ...info }));
  if (info.overflow) await p.screenshot(`_qa_shots/mob-${name}.png`);
  if (p.errors.length) console.log('   JSERR:', JSON.stringify(p.errors.slice(0,2).map(e=>e.desc||e.text)));
}
await p.close(); await b.close();
console.log('MOBILE DONE');
