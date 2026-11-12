/** QA D2 — link hỏng, nút không handler, text sai sự thật trên toàn site. */
import { connect, mkReport } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const ROUTES = ['/', '/products', '/product/license-xarena-thang', '/tai-ve', '/huong-dan', '/support', '/login', '/register'];

// route thật theo app.js
const VALID = [
  /^\/$/, /^\/products$/, /^\/product\/[^/]+$/, /^\/login$/, /^\/register$/,
  /^\/checkout$/, /^\/account$/, /^\/orders$/, /^\/wallet$/, /^\/order\/[^/]+$/,
  /^\/licenses$/, /^\/support$/, /^\/huong-dan$/, /^\/tai-ve$/, /^\/admin$/,
];

(async () => {
  const B = await connect();
  const R = mkReport('PHẦN D — LINK / NÚT / TEXT SAI SỰ THẬT');
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});

  const allLinks = [];
  const badBtns = [];

  for (const p of ROUTES) {
    await B.goto(p, 3000);
    const links = await B.links();
    for (const l of links) {
      const h = l.href;
      if (!h || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) continue;
      if (/^https?:\/\//.test(h)) {
        if (!/xienhl\.com/.test(h) && !/^https:\/\/t\.me|zalo\.me|vietqr/.test(h)) {
          allLinks.push({ from: p, ...l, external: true });
        }
        continue;
      }
      if (h === '#' || h === '') { allLinks.push({ from: p, ...l, broken: true, why: 'href="#"' }); continue; }
      if (h.startsWith('#')) {
        let path = h.slice(1).split('?')[0];
        if (!path || path === '/') continue;
        path = path.replace(/#.*$/, '');
        const ok = VALID.some((re) => re.test(path));
        if (!ok) allLinks.push({ from: p, ...l, broken: true, why: 'route không tồn tại: ' + path });
      } else if (h.startsWith('/')) {
        // link không phải hash -> tải file / api
        if (!/^\/(download|i|xg|assets|img)\//.test(h)) {
          allLinks.push({ from: p, ...l, broken: true, why: 'link thường (không hash): ' + h });
        }
      }
    }

    // nút không có onclick/không phải submit/không có data-attr -> nghi không handler
    const btns = await B.ev(`(function(){
      var out=[];
      document.querySelectorAll('button').forEach(function(b){
        var hasOnclick = !!b.onclick;
        var hasData = Array.from(b.attributes).some(function(a){return a.name.indexOf('data-')===0});
        var isSubmit = b.type==='submit' || b.closest('form');
        var hasAria = b.getAttribute('aria-label');
        if(!hasOnclick && !hasData && !isSubmit){
          out.push({txt:(b.innerText||'').trim().slice(0,50), cls:(b.className||'').slice(0,50), id:b.id});
        }
      });
      return out;
    })()`);
    if (btns && btns.length) badBtns.push({ page: p, btns });
  }

  const broken = allLinks.filter((l) => l.broken);
  R.ok(28, 'Không có link trỏ route không tồn tại', broken.length === 0,
    broken.slice(0, 10).map((b) => `[${b.from}] "${b.text}" -> ${b.href} (${b.why})`).join(' || '));

  const totalBadBtns = badBtns.reduce((s, x) => s + x.btns.length, 0);
  R.ok(29, 'Không có nút thiếu handler (không onclick/data/submit)', totalBadBtns === 0,
    badBtns.map((x) => `[${x.page}] ` + x.btns.map((b) => `"${b.txt}"#${b.id}.${b.cls}`).join(', ')).join(' || '));

  // ---------- TEXT SAI SỰ THẬT ----------
  const FACTS = [
    { id: 23, name: '"nạp tiền"/"ví"/"số dư" còn sót', re: /nạp tiền|ví tiền|số dư ví|Nạp tiền/i, allow: [] },
    { id: 24, name: '"offline grace 24 giờ" (grace thật = 0)', re: /offline grace|grace 24/i },
    { id: 25, name: '"17 cổng thanh toán"', re: /17 cổng|17 payment/i },
    { id: 26, name: '"gửi key qua email" (không có hệ thống mail)', re: /qua email|gửi.*email/i },
    { id: 27, name: 'Số liệu bịa: 4.9★ / 99.9% / "hàng đầu Việt Nam"', re: /4[.,]9\s*(★|sao|\/\s*5)|99[.,]9\s*%|hàng đầu Việt Nam/i },
    { id: '27b', name: 'Đánh giá 5.0 nhưng 0 đánh giá thật', re: /5\.0\s*\(\s*0\s*đánh giá\)/i },
  ];
  const hits = {};
  for (const p of ROUTES) {
    await B.goto(p, 2800);
    const t = String(await B.text());
    for (const f of FACTS) {
      const m = t.match(f.re);
      if (m) {
        const line = t.split('\n').find((l) => f.re.test(l)) || m[0];
        (hits[f.id] = hits[f.id] || []).push(`${p}: "${line.trim().slice(0, 110)}"`);
      }
    }
  }
  for (const f of FACTS) {
    const h = hits[f.id];
    if (h) R.ok(f.id, f.name, false, h.slice(0, 6).join(' || '));
    else R.ok(f.id, f.name, true);
  }

  // đo giá trị rating thật từ API
  const apiProducts = await B.ev(`fetch('/api/products?page=1&perPage=20',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.products||[]).map(p=>({slug:p.slug,name:p.name,rating:p.rating,count:p.ratingCount,sold:p.sold})))`);
  R.info('27c', 'rating/ratingCount thật từ API', JSON.stringify(apiProducts));

  const c = R.print();
  writeFileSync('_qa_shots/report-D2.json', JSON.stringify({ rows: c.rows, counts: R.counts, broken, badBtns, hits, apiProducts }, null, 2));
  await B.close();
})();
