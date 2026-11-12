/** Đo tốc độ đúng: mỗi trang là 1 DOCUMENT MỚI (hash route không reload). */
import { connect } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const PAGES = ['/', '/products', '/product/license-xarena-thang', '/tai-ve', '/checkout'];

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  const out = [];

  for (const p of PAGES) {
    // reset sạch: xoá cache + hard navigate (kèm ?_=ts để phá SPA hash)
    await B.send('Network.clearBrowserCache').catch(() => {});
    await B.send('Network.setCacheDisabled', { cacheDisabled: false });
    await B.send('Page.navigate', { url: 'https://xienhl.com/?_qa=' + Date.now() + '#' + p });
    await B.wait(250);

    let renderMs = null;
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      const n = await B.ev("(document.body.innerText||'').length").catch(() => 0);
      if (n > 400) { renderMs = Date.now() - t0; break; }
      await B.wait(100);
    }
    await B.wait(800);

    const nav = await B.ev(`(function(){
      var n=performance.getEntriesByType('navigation')[0]||{};
      var res=performance.getEntriesByType('resource');
      var bytes=res.reduce(function(s,r){return s+(r.transferSize||0)},0);
      var slow=res.map(function(r){return {name:r.name.replace(location.origin,''),dur:Math.round(r.duration),size:r.transferSize||0,type:r.initiatorType}})
        .filter(function(r){return r.dur>0}).sort(function(a,b){return b.dur-a.dur});
      var big=res.map(function(r){return {name:r.name.replace(location.origin,''),size:r.transferSize||0}})
        .sort(function(a,b){return b.size-a.size});
      return {ttfb:Math.round(n.responseStart||0), dcl:Math.round(n.domContentLoadedEventEnd||0),
        load:Math.round(n.loadEventEnd||0), reqs:res.length, bytes:bytes,
        slowest:slow.slice(0,6), biggest:big.slice(0,6)};
    })()`);

    out.push({ page: p, renderMs, ...nav });
    console.log(`\n${p}`);
    console.log(`  render nội dung: ${renderMs ?? 'TIMEOUT'}ms | TTFB ${nav.ttfb}ms | DOMReady ${nav.dcl}ms | load ${nav.load}ms`);
    console.log(`  ${nav.reqs} request, ${(nav.bytes/1024).toFixed(1)} KB`);
    console.log('  chậm nhất:'); nav.slowest.forEach((s) => console.log(`    ${s.dur}ms  ${s.name.slice(0,70)} (${(s.size/1024).toFixed(0)}KB)`));
    console.log('  nặng nhất:'); nav.biggest.forEach((s) => console.log(`    ${(s.size/1024).toFixed(0)}KB  ${s.name.slice(0,70)}`));
  }

  writeFileSync('_qa_shots/perf.json', JSON.stringify(out, null, 2));
  console.log('\n=== TỔNG ===');
  for (const r of out) {
    console.log(`${r.page.padEnd(34)} render ${String(r.renderMs).padStart(4)}ms   TTFB ${String(r.ttfb).padStart(3)}ms   ${String(Math.round(r.bytes/1024)).padStart(4)}KB   ${r.reqs} req`);
  }
  await B.close();
})();
