/** XÁC MINH CUỐI trên production: tất cả fix + không hồi quy. */
import { connect, mkReport } from './harness.mjs';
import { writeFileSync } from 'node:fs';

(async () => {
  const B = await connect();
  const R = mkReport('XÁC MINH CUỐI — PRODUCTION xienhl.com');
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  await B.send('Network.clearBrowserCache').catch(() => {});
  await B.send('Network.setCacheDisabled', { cacheDisabled: true });

  // ---- 1. /tai-ve: P0 fix ----
  await B.send('Page.navigate', { url: 'https://xienhl.com/?f=' + Date.now() + '#/tai-ve' });
  await B.wait(5000);
  const dl = await B.ev(`(function(){
    var d=document.documentElement, svgs=Array.from(document.querySelectorAll('svg'));
    return {scrollW:d.scrollWidth, clientW:d.clientWidth,
      maxSvg: Math.max(0,...svgs.map(s=>Math.round(s.getBoundingClientRect().width))),
      bigSvg: svgs.filter(s=>s.getBoundingClientRect().width>2000).length,
      textLen: document.body.innerText.length,
      btn: !!document.querySelector('[data-dl-url]'),
      hash: (document.querySelector('[data-dl-hash]')||{}).textContent||'',
      hashLen: ((document.querySelector('[data-dl-hash]')||{}).textContent||'').trim().length,
      smart: /SmartScreen/i.test(document.body.innerText)};
  })()`);
  R.ok(1, '/tai-ve không tràn ngang (P0 đã fix)', dl.scrollW <= dl.clientW + 1 && dl.bigSvg === 0,
    `scrollW=${dl.scrollW} maxSvg=${dl.maxSvg}px bigSvg=${dl.bigSvg}`);
  R.ok('1b', '/tai-ve render đủ nội dung', dl.textLen > 2000 && dl.btn && dl.smart,
    `${dl.textLen} ký tự, nút tải=${dl.btn}, SmartScreen=${dl.smart}`);
  R.ok('1c', '/tai-ve có SHA-256 đủ 64 ký tự', dl.hashLen === 64, `"${dl.hash}" (${dl.hashLen})`);
  await B.shot('F1-tai-ve-fixed', { clip: { x: 0, y: 0, width: 1440, height: 1300 } });

  // ---- 2. Rating không còn bịa ----
  await B.goto('/product/license-xarena-thang', 3500);
  const rating = await B.ev(`(function(){
    var t=document.body.innerText;
    return {badFive: /5\\.0\\s*\\(\\s*0\\s*đánh giá\\)/.test(t),
      stars: document.querySelectorAll('.pd-stars').length,
      hasSold: /Đã bán/.test(t),
      snippet: (t.match(/Đã bán[^\\n]*/)||[])[0]||''};
  })()`);
  R.ok(2, 'Không còn "5.0 (0 đánh giá)"', !rating.badFive, `sao hiện=${rating.stars}, "${rating.snippet}"`);

  // ---- 3. Grace đã sửa trong API ----
  const feat = await B.ev(`fetch('/api/products/license-xarena-thang').then(r=>r.json()).then(d=>d.product.features)`);
  const badGrace = (feat || []).some((f) => /offline grace/i.test(f));
  R.ok(3, 'Không còn feature "offline grace" (grace thật = 0)', !badGrace, JSON.stringify(feat));

  // ---- 4. Footer không còn "hàng đầu Việt Nam" ----
  await B.goto('/', 3200);
  const foot = await B.ev(`(document.querySelector('.footer-desc')||{}).innerText||''`);
  R.ok(4, 'Footer không còn "hàng đầu Việt Nam"', !/hàng đầu/i.test(foot), foot.replace(/\n/g, ' ').slice(0, 130));

  // ---- 5. account: không còn "Số dư ví" ----
  await B.goto('/login', 2500);
  await B.ev(`localStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.goto('/login', 2800);
  await B.ev(`(function(){document.querySelector('#lg-email').value='namhbcf';document.querySelector('#lg-pwd').value='namhbcf123';document.querySelector('#login-submit').click();return 1})()`);
  await B.wait(5000);
  await B.goto('/account', 3500);
  const acct = await B.ev(`(function(){
    var t=document.body.innerText;
    return {txt:t.slice(0,500), hasSoDu:/Số dư/i.test(t), hasVi:/ví/i.test(t),
      metrics: Array.from(document.querySelectorAll('.metric-lbl')).map(x=>x.innerText.trim())};
  })()`);
  R.ok(5, '/account không còn "Số dư ví"/"ví"', !acct.hasSoDu && !acct.hasVi,
    `metrics=${JSON.stringify(acct.metrics)}`);

  // ---- 6. Admin: 11 tab, không 1970, không cột Số dư ----
  const tabs = ['dashboard','orders','topups','products','keys','licenses','trial','whitelist','users','settings','logs'];
  let tabFail = [];
  for (const t of tabs) {
    await B.goto('/admin?tab=' + t, 3200);
    const i = await B.ev(`(function(){
      var h=document.getElementById('admin-content');
      return {len:h?h.innerText.length:0, t:h?h.innerText:'',
        heads:Array.from((h||document).querySelectorAll('th')).map(x=>x.innerText.trim())};
    })()`);
    if (i.len < 30 || /Mount error/i.test(i.t)) tabFail.push(t + ':len' + i.len);
    if (/1970|Invalid Date|NaN/.test(i.t)) tabFail.push(t + ':1970');
    if (t === 'users' && i.heads.some((x) => /số dư/i.test(x))) tabFail.push('users:còn cột Số dư');
  }
  R.ok(6, '11/11 tab admin OK, không 1970, users không cột Số dư', tabFail.length === 0, tabFail.join(', '));

  // ---- 7. Mobile 390: QR đủ + không tràn ----
  await B.viewport(390, 844, true);
  await B.goto('/product/license-xarena-thang', 3200);
  await B.ev(`document.querySelector('#btn-add-cart')?.click()`);
  await B.wait(1200);
  await B.goto('/checkout', 3200);
  await B.ev(`document.querySelector('#btn-place-order')?.click()`);
  await B.wait(7000);
  const mq = await B.ev(`(function(){
    var img=document.querySelector('[data-qr-img]'), t=document.body.innerText;
    var r=img?img.getBoundingClientRect():null;
    return {sw:document.documentElement.scrollWidth,
      imgW:r?Math.round(r.width):0, inView:r?(r.right<=390.5&&r.left>=-0.5):false,
      amt:(t.match(/([0-9]{1,3}(?:\\.[0-9]{3}){1,2})\\s*₫/)||[])[1]||null,
      memo:(t.match(/MBK[A-Z0-9]{3,}/)||[])[0]||null, stk:/0010131639304/.test(t),
      cd:document.querySelector('#qr-countdown')?.textContent||null};
  })()`);
  R.ok(7, '[390px] QR hiện đủ, không tràn ngang', mq.sw <= 391 && mq.inView && mq.imgW >= 180,
    `scrollW=${mq.sw} ảnh=${mq.imgW}px inView=${mq.inView}`);
  R.ok('7b', '[390px] QR đúng tiền/memo/STK', mq.amt === '180.000' && !!mq.memo && mq.stk,
    `${mq.amt} · ${mq.memo} · STK ok · ${mq.cd}`);
  await B.shot('F2-mobile-qr-final', { clip: { x: 0, y: 0, width: 390, height: 1600 } });

  // ---- 8. Rò rỉ poll: KHÔNG còn (bản production) ----
  await B.ev(`(function(){
    window.__c=[]; var of=window.fetch;
    window.fetch=function(x){ window.__c.push(String(x)); return of.apply(this,arguments); };
    return 1;
  })()`);
  await B.send('Page.navigate', { url: 'https://xienhl.com/#/support' });
  await B.wait(1500);
  await B.ev(`window.__c=[]; 1`);
  await B.wait(13000);
  const calls = await B.ev('window.__c') || [];
  const polls = calls.filter((c) => /\/api\/orders\/[0-9a-f-]{36}$/.test(c));
  R.ok(8, 'Rời trang QR KHÔNG còn poll (P0 đã fix)', polls.length === 0,
    `${polls.length} poll /api/orders trong 14s (tổng fetch ${calls.length})`);

  const c = R.print();
  writeFileSync('_qa_shots/final-verify.json', JSON.stringify({ rows: c.rows, counts: R.counts, dl, rating, feat, foot, acct, mq, polls: polls.length }, null, 2));
  await B.close();
})();
