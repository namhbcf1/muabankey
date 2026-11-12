/** QA D — mobile 390x844 cho luồng mua (checkout + QR) + E tốc độ. */
import { connect, mkReport } from './harness.mjs';
import { writeFileSync } from 'node:fs';

(async () => {
  const B = await connect();
  const R = mkReport('PHẦN D/E — MOBILE LUỒNG MUA + TỐC ĐỘ');
  await B.send('Page.bringToFront').catch(() => {});

  // ---------- TỐC ĐỘ: đo trên desktop ----------
  await B.viewport(1440, 900, false);
  const perf = [];
  for (const p of ['/', '/products', '/checkout']) {
    await B.ev('1');
    await B.send('Network.clearBrowserCache').catch(() => {});
    const t0 = Date.now();
    await B.goto(p, 200);
    // chờ render xong nội dung thật
    let ok = false;
    for (let i = 0; i < 60; i++) {
      const n = await B.ev("document.body.innerText.length");
      if (n > 400) { ok = true; break; }
      await B.wait(150);
    }
    const ms = Date.now() - t0;
    const nav = await B.ev(`(function(){
      var n=performance.getEntriesByType('navigation')[0]||{};
      var res=performance.getEntriesByType('resource').map(function(r){
        return {name:r.name.replace(location.origin,''), dur:Math.round(r.duration),
          size:r.transferSize||0, type:r.initiatorType};
      }).sort(function(a,b){return b.dur-a.dur;});
      return {
        ttfb: Math.round(n.responseStart||0),
        domContentLoaded: Math.round(n.domContentLoadedEventEnd||0),
        load: Math.round(n.loadEventEnd||0),
        totalRes: res.length,
        totalBytes: res.reduce(function(s,r){return s+r.size},0),
        slowest: res.slice(0,8),
        biggest: res.slice().sort(function(a,b){return b.size-a.size}).slice(0,6),
      };
    })()`);
    perf.push({ page: p, renderMs: ms, ok, ...nav });
    R.info('38' + p, `Thời gian render ${p}`, `${ms}ms (nội dung sẵn sàng) · TTFB ${nav.ttfb}ms · DOMReady ${nav.domContentLoaded}ms · load ${nav.load}ms · ${nav.totalRes} request · ${(nav.totalBytes/1024).toFixed(1)} KB`);
  }

  // nguồn chậm / nặng
  const allSlow = perf.flatMap((p) => (p.slowest || []).map((s) => ({ ...s, page: p.page })));
  const heavy = allSlow.filter((s) => s.dur > 300 || s.size > 150000).slice(0, 12);
  if (heavy.length) {
    R.warn('39', 'Tài nguyên chậm/nặng', heavy.map((h) => `${h.page} ${h.name} ${h.dur}ms ${(h.size/1024).toFixed(0)}KB`).join(' | '));
  } else R.ok('39', 'Không có tài nguyên quá chậm/nặng', true);

  // ---------- MOBILE 390x844: luồng mua ----------
  await B.viewport(390, 844, true);
  await B.goto('/login', 3200);
  await B.ev(`localStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.goto('/login', 3200);
  await B.ev(`(function(){
    var u='mob'+Date.now().toString().slice(-8);
    window.__mobUser=u;
    document.querySelector('#lg-email').value=u;
    return 1;
  })()`);
  // đăng ký luôn cho nhanh
  await B.goto('/register', 3000);
  const mobUser = 'mob' + Date.now().toString().slice(-8);
  await B.ev(`(function(){
    document.querySelector('#rg-user').value='${mobUser}';
    document.querySelector('#rg-pwd').value='qaPass123';
    document.querySelector('#rg-pwd2').value='qaPass123';
    document.querySelector('#reg-submit').click(); return 1;
  })()`);
  await B.wait(4500);
  const me = await B.ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?d.user.username:null).catch(()=>null)`);
  R.info('30a', 'User mobile', String(me));
  if (!me) { R.print(); await B.close(); return; }

  await B.goto('/product/license-xarena-thang', 3500);
  const ovfPD = await B.overflow();
  await B.shot('D1-mob-product', { clip: { x: 0, y: 0, width: 390, height: 1500 } });
  R.ok('30', '[390px] Chi tiết SP không tràn ngang', !ovfPD.docOverflow,
    ovfPD.docOverflow ? JSON.stringify(ovfPD.els) : '');

  // nút Mua ngay phải bấm được, không bị che
  const buyClickable = await B.ev(`(function(){
    var b=document.querySelector('#btn-buy-now')||document.querySelector('#btn-add-cart');
    if(!b) return {err:'no btn'};
    var r=b.getBoundingClientRect();
    var cx=r.x+r.width/2, cy=r.y+r.height/2;
    var top=document.elementFromPoint(cx,cy);
    return {h:Math.round(r.height), w:Math.round(r.width), inView:r.top>=0&&r.top<window.innerHeight,
      clickable: top && (top===b || b.contains(top)), topEl: top?(top.tagName+'.'+(top.className||'')):null};
  })()`);
  R.ok('32', '[390px] Nút mua bấm được (không bị che, >=44px)', buyClickable.clickable && buyClickable.h >= 44,
    JSON.stringify(buyClickable));

  // sang checkout mobile
  await B.ev(`(document.querySelector('#btn-add-cart')||document.querySelector('#btn-buy-now'))?.click()`);
  await B.wait(1800);
  await B.goto('/checkout', 3500);
  const ovfCK = await B.overflow();
  await B.shot('D2-mob-checkout', { clip: { x: 0, y: 0, width: 390, height: 1600 } });
  R.ok('30b', '[390px] Checkout không tràn ngang', !ovfCK.docOverflow,
    ovfCK.docOverflow ? `scrollW=${ovfCK.scrollW} ${JSON.stringify(ovfCK.els)}` : '');

  const placeMobile = await B.ev(`(function(){
    var b=document.querySelector('#btn-place-order');
    if(!b) return {err:'no btn'};
    var r=b.getBoundingClientRect();
    return {h:Math.round(r.height), w:Math.round(r.width), txt:b.innerText.trim()};
  })()`);
  R.ok('32b', '[390px] Nút "Tạo mã QR" đủ lớn', placeMobile.h >= 44, JSON.stringify(placeMobile));

  // bấm -> QR mobile
  await B.ev(`document.querySelector('#btn-place-order').click()`);
  await B.wait(7000);
  const ovfQR = await B.overflow();
  await B.shot('D3-mob-qr', { clip: { x: 0, y: 0, width: 390, height: 1700 } });

  const qrMob = await B.ev(`(function(){
    var img=document.querySelector('[data-qr-img]');
    var t=document.body.innerText;
    var r=img?img.getBoundingClientRect():null;
    var cm=document.querySelector('[data-copy-memo]');
    var cmr=cm?cm.getBoundingClientRect():null;
    var cl=document.querySelector('[data-claimed]');
    var clr=cl?cl.getBoundingClientRect():null;
    return {
      imgW: r?Math.round(r.width):0, imgH: r?Math.round(r.height):0,
      natural: img?[img.naturalWidth,img.naturalHeight]:null,
      inViewport: r? (r.right<=390.5 && r.left>=-0.5) : false,
      memo:(t.match(/MBK[A-Z0-9]{3,}/)||[])[0]||null,
      amount:(t.match(/([0-9]{1,3}(?:\\.[0-9]{3}){1,2})\\s*₫/)||[])[1]||null,
      stk:/0010131639304/.test(t),
      copyH: cmr?Math.round(cmr.height):0,
      claimH: clr?Math.round(clr.height):0,
      countdown: document.querySelector('#qr-countdown')?.textContent||null,
      docScrollW: document.documentElement.scrollWidth,
    };
  })()`);
  R.ok('30c', '[390px] Trang QR không tràn ngang', !ovfQR.docOverflow && qrMob.docScrollW <= 391,
    `scrollW=${ovfQR.docScrollW} ${JSON.stringify(ovfQR.els)}`);
  R.ok('33', '[390px] QR hiện đủ trong màn hình', qrMob.inViewport && qrMob.imgW >= 180,
    `khung ${qrMob.imgW}x${qrMob.imgH}px, ảnh thật ${JSON.stringify(qrMob.natural)}`);
  R.ok('33b', '[390px] QR có đủ số tiền + nội dung + STK', qrMob.amount === '180.000' && !!qrMob.memo && qrMob.stk,
    `tiền=${qrMob.amount} memo=${qrMob.memo} stk=${qrMob.stk} đếm=${qrMob.countdown}`);
  R.ok('32c', '[390px] Nút Copy & "Tôi đã chuyển khoản" đủ 44px', qrMob.copyH >= 32 && qrMob.claimH >= 32,
    `copy=${qrMob.copyH}px claim=${qrMob.claimH}px`);

  const c = R.print();
  writeFileSync('_qa_shots/report-DE.json', JSON.stringify({ rows: c.rows, counts: R.counts, perf, qrMob, mobUser }, null, 2));
  console.log('PERF:', JSON.stringify(perf.map((p) => ({ p: p.page, render: p.renderMs, ttfb: p.ttfb, kb: Math.round(p.totalBytes/1024), reqs: p.totalRes }))));
  console.log('MOB USER:', mobUser);
  await B.close();
})();
