import { launch, connect, newPage, PROD, sleep } from '../qa/cdp.mjs';
const B = await launch({ port: 9337, headless: true, width: 1280, height: 900 });
const br = await connect(B.port);
const p = await newPage(br, { width: 1280, height: 900 });
const routes = ['/', '/products', '/tai-ve', '/huong-dan', '/support', '/login'];
const res = [];
for (const r of routes) {
  p.clearLogs();
  await p.goto(PROD + '/#' + r, { waitUntil: 'networkIdle', timeout: 35000 });
  await sleep(2200);
  const st = await p.eval(`(()=>({
    hash: location.hash,
    appLen: document.getElementById('app')?.innerHTML.length || 0,
    hasHeader: !!document.querySelector('.header'),
    hasFooter: !!document.querySelector('footer'),
    h1: document.querySelector('h1')?.textContent?.trim().slice(0,50) || null,
  }))()`);
  res.push({ route: r, ...st, errors: p.errors.length, httpErrors: p.httpErrors.length });
}
console.log(JSON.stringify(res, null, 2));
await p.close(); await B.close(); process.exit(0);
