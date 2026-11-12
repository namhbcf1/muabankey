/** QA A — trang công khai, desktop 1440 + mobile 390. */
import { connect, mkReport, BASE } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const PAGES = [
  { id: 1, path: '/', name: 'Trang chủ', shot: 'A1-home' },
  { id: 2, path: '/products', name: 'Danh sách sản phẩm', shot: 'A2-products' },
  { id: 3, path: '/product/license-xarena-thang', name: 'Chi tiết sản phẩm', shot: 'A3-product-detail' },
  { id: 4, path: '/tai-ve', name: 'Tải EXE', shot: 'A4-download' },
  { id: 5, path: '/huong-dan', name: 'Hướng dẫn SmartScreen', shot: 'A5-guide' },
  { id: 6, path: '/support', name: 'Hỗ trợ', shot: 'A6-support' },
  { id: 7, path: '/login', name: 'Đăng nhập', shot: 'A7-login' },
  { id: 8, path: '/register', name: 'Đăng ký', shot: 'A8-register' },
  { id: 9, path: '/khong-ton-tai-xyz', name: '404', shot: 'A9-404' },
];

const timings = [];

(async () => {
  const B = await connect();
  const R = mkReport('PHẦN A — TRANG CÔNG KHAI');
  const mobile = [];

  await B.viewport(1440, 900, false);

  for (const P of PAGES) {
    const t0 = Date.now();
    await B.goto(P.path, 3500);
    const loadMs = Date.now() - t0;
    B.startCollect();
    await B.wait(1200);

    const txt = await B.text();
    const ovf = await B.overflow();
    const log = B.stopCollect();
    await B.shot(P.shot, { clip: { x: 0, y: 0, width: 1440, height: 1200 } });

    const routesMissing = new Set([
      '/wallet', '/topup', '/nap-tien', '/payment', '/cart',
    ]);
    const links = await B.links();
    const brokenLinks = links.filter((l) => {
      const p = l.href.replace(/^#/, '').split('?')[0].replace(/\/$/, '') || '/';
      return routesMissing.has(p);
    });

    const errCount = log.console.filter((c) => c.type !== 'warning').length;
    const httpErr = log.http.filter((h) => h.status >= 400);

    const rendered = txt.length > 200 && !txt.includes('boot-screen');
    timings.push({ path: P.path, ms: loadMs, kb: null });

    R.ok(P.id, `${P.name} (${P.path}) — render`, rendered, rendered ? `${txt.length} ký tự` : `QUÁ NGẮN: ${txt.slice(0, 120)}`);
    R.ok(`${P.id}c`, `${P.name} — 0 console error`, errCount === 0,
      log.console.slice(0, 4).map((c) => `[${c.type}] ${c.text}`).join(' || '));
    R.ok(`${P.id}h`, `${P.name} — 0 HTTP error`, httpErr.length === 0,
      httpErr.slice(0, 4).map((h) => `${h.status} ${h.url}`).join(' || '));
    R.ok(`${P.id}d`, `${P.name} — không tràn ngang (1440)`, !ovf.docOverflow,
      ovf.docOverflow ? `scrollW=${ovf.scrollW} clientW=${ovf.clientW} :: ${JSON.stringify(ovf.els)}` : '');
    if (brokenLinks.length) {
      R.warn(`${P.id}l`, `${P.name} — link trỏ route đã bỏ`, JSON.stringify(brokenLinks.slice(0, 5)));
    }
  }

  // ---------- MOBILE 390x844 ----------
  await B.viewport(390, 844, true);
  const MOB = [
    { id: 30, path: '/', name: 'Trang chủ', shot: 'M1-home' },
    { id: 31, path: '/products', name: 'Sản phẩm', shot: 'M2-products' },
    { id: 32, path: '/product/license-xarena-thang', name: 'Chi tiết SP', shot: 'M3-product-detail' },
    { id: 33, path: '/tai-ve', name: 'Tải EXE', shot: 'M4-download' },
    { id: 34, path: '/login', name: 'Đăng nhập', shot: 'M5-login' },
    { id: 35, path: '/support', name: 'Hỗ trợ', shot: 'M6-support' },
  ];
  for (const P of MOB) {
    await B.goto(P.path, 3200);
    const ovf = await B.overflow();
    await B.shot(P.shot, { clip: { x: 0, y: 0, width: 390, height: 844 } });
    mobile.push({ ...P, ovf });
    R.ok(P.id, `[390px] ${P.name} — không tràn ngang`, !ovf.docOverflow,
      ovf.docOverflow ? `scrollW=${ovf.scrollW} vs clientW=${ovf.clientW} :: ${JSON.stringify(ovf.els)}` : '');
  }

  const c = R.print();
  writeFileSync('_qa_shots/report-A.json', JSON.stringify({ ...c, mobile, timings }, null, 2));
  console.log('MOBILE OVERFLOW DETAIL:');
  for (const m of mobile) console.log(' ', m.name, m.ovf.docOverflow ? 'OVERFLOW ' + JSON.stringify(m.ovf.els) : 'ok');
  await B.close();
})();
