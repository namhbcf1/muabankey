/** QA B — luồng khách: đăng ký -> giỏ -> checkout -> QR -> orders -> licenses. */
import { connect, mkReport } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const STATE = {};

(async () => {
  const B = await connect();
  const R = mkReport('PHẦN B — LUỒNG KHÁCH (đăng ký → QR → đơn → license)');
  await B.viewport(1440, 900, false);

  // ---------- 8. Đăng ký user mới ----------
  const uname = 'qa' + Date.now().toString().slice(-8);
  STATE.uname = uname;
  await B.goto('/login', 3000);
  await B.ev(`localStorage.clear(); sessionStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.goto('/register', 3000);

  await B.ev(`(function(){
    document.querySelector('#rg-user').value='${uname}';
    document.querySelector('#rg-pwd').value='qaPass123';
    document.querySelector('#rg-pwd2').value='qaPass123';
    document.querySelector('#reg-submit').click();
    return 1;
  })()`);
  await B.wait(4500);

  const me = await B.ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?{u:d.user.username,role:d.user.role}:null).catch(e=>null)`);
  R.ok(8, 'Đăng ký user mới qua UI', me && me.u === uname, me ? `${me.u} / ${me.role}` : 'không đăng nhập được');
  if (!me) { R.print(); await B.close(); return; }

  const headTxt = String(await B.ev(`document.querySelector('header')?.innerText || ''`));
  R.ok('8b', 'Header sau đăng nhập render (có tên user)', headTxt.length > 5, headTxt.replace(/\n/g, ' | ').slice(0, 120));

  // ---------- 9. Thêm vào giỏ ----------
  await B.goto('/product/license-xarena-thang', 3500);
  const addBtn = await B.ev(`(function(){
    var b=document.querySelector('#btn-add-cart')||document.querySelector('[data-add-cart]');
    if(!b) return null;
    b.click(); return b.id||b.className;
  })()`);
  await B.wait(2500);
  const cartCount = await B.ev(`(function(){
    var t=document.body.innerText;
    var m=t.match(/Giỏ hàng\\s*\\((\\d+)\\)/);
    return {badge: document.querySelector('[data-cart-count]')?.textContent||null, raw: m?m[1]:null,
      ls: localStorage.getItem('mbk_cart')};
  })()`);
  R.ok(9, 'Thêm sản phẩm vào giỏ', addBtn !== null && !!(cartCount.ls && cartCount.ls.includes('p-lic-month')),
    `btn=${addBtn} badge=${cartCount.badge} cart=${(cartCount.ls || '').slice(0, 160)}`);

  // ---------- 10. Checkout ----------
  await B.goto('/checkout', 3500);
  const ck = String(await B.text());
  const hasQRPay = /Chuyển khoản QR/i.test(ck);
  R.ok(10, 'Checkout hiện "Thanh toán Chuyển khoản QR"', hasQRPay, ck.slice(0, 200).replace(/\n/g, ' | '));

  const placeBtn = await B.ev(`!!document.querySelector('#btn-place-order')`);
  R.ok('10b', 'Có nút "Tạo mã QR thanh toán"', placeBtn,
    String(await B.ev(`document.querySelector('#btn-place-order')?.innerText||''`)));

  // ---------- 11. Bấm tạo QR ----------
  await B.startCollect();
  await B.ev(`document.querySelector('#btn-place-order').click()`);
  await B.wait(7000);
  const loginLog = B.stopCollect();

  const hash = await B.hash();
  const qrTxt = String(await B.text());
  R.ok(11, 'Bấm xác nhận → chuyển trang QR', /\/order\//.test(String(hash)) || /Quét mã/.test(qrTxt), String(hash));

  const qrInfo = await B.ev(`(function(){
    var t=document.body.innerText;
    return {
      hasImg: !!document.querySelector('[data-qr-img]'),
      imgSrc: (document.querySelector('[data-qr-img]')||{}).src||'',
      imgNatural: (function(){var i=document.querySelector('[data-qr-img]'); return i?[i.naturalWidth,i.naturalHeight]:null})(),
      memo: (t.match(/MBK[A-Z0-9]{3,}/)||[])[0]||null,
      amount: (t.match(/([0-9]{1,3}(?:\\.[0-9]{3}){1,2})\\s*₫/)||[])[1]||null,
      stk: /0010131639304/.test(t),
      bank: (t.match(/Ngân hàng:\\s*(.+)/)||[])[1]||null,
      owner: (t.match(/Chủ TK:\\s*(.+)/)||[])[1]||null,
      countdown: document.querySelector('#qr-countdown')?.textContent||null,
      claimed: !!document.querySelector('[data-claimed]'),
      claimedText: document.querySelector('[data-claimed]')?.innerText||null,
      copyBtn: !!document.querySelector('[data-copy-memo]'),
      orderId: (location.hash.match(/\\/order\\/([^/?#]+)/)||[])[1]||null,
    };
  })()`);
  STATE.qr = qrInfo;
  STATE.orderId = qrInfo.orderId;

  R.ok('11a', 'QR: ảnh hiển thị thật (naturalWidth>0)', !!qrInfo.imgNatural && qrInfo.imgNatural[0] > 50,
    `src=${qrInfo.imgSrc.slice(0, 90)} size=${JSON.stringify(qrInfo.imgNatural)}`);
  R.ok('11b', 'QR: số tiền đúng 180.000₫', qrInfo.amount === '180.000', String(qrInfo.amount));
  R.ok('11c', 'QR: nội dung có tiền tố MBK', !!qrInfo.memo, String(qrInfo.memo));
  R.ok('11d', 'QR: STK 0010131639304', qrInfo.stk, `bank=${qrInfo.bank} owner=${qrInfo.owner}`);
  R.ok('11e', 'QR: đếm ngược chạy (mm:ss)', /^\d{2}:\d{2}$/.test(String(qrInfo.countdown)), String(qrInfo.countdown));
  R.ok('11f', 'QR: nút "Tôi đã chuyển khoản"', qrInfo.claimed, String(qrInfo.claimedText));

  // ---------- 12. Nút copy ----------
  await B.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: 'https://xienhl.com' }).catch(() => {});
  const copyRes = await B.ev(`(async function(){
    var b=document.querySelector('[data-copy-memo]');
    if(!b) return {err:'no btn'};
    b.click();
    await new Promise(r=>setTimeout(r,900));
    var toasts=Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim());
    var clip=null; try{ clip=await navigator.clipboard.readText(); }catch(e){ clip='ERR:'+e.name; }
    return {toast:toasts, clip:clip};
  })()`);
  const copyOk = copyRes.clip && !String(copyRes.clip).startsWith('ERR:');
  R.ok(12, 'Nút Copy nội dung hoạt động (clipboard == memo)', copyOk && String(copyRes.clip).trim() === String(qrInfo.memo),
    `clip=${JSON.stringify(copyRes.clip)} memo=${qrInfo.memo} toast=${JSON.stringify(copyRes.toast)}`);
  STATE.copy = copyRes;

  await B.shot('B1-qr-payment', { clip: { x: 0, y: 0, width: 1440, height: 1150 } });

  // ---------- 13. /orders ----------
  await B.goto('/orders', 3500);
  const ordTxt = String(await B.text());
  const ordHas = qrInfo.memo ? ordTxt.includes(qrInfo.memo) : /MBK/.test(ordTxt);
  R.ok(13, '/orders hiện đơn vừa tạo đúng mã/nội dung', ordHas,
    `memo=${qrInfo.memo} | ${ordTxt.slice(0, 300).replace(/\n/g, ' | ')}`);
  await B.shot('B2-orders', { clip: { x: 0, y: 0, width: 1440, height: 1100 } });

  // ---------- 14. Bấm "Thanh toán ngay" — KHÔNG tạo đơn mới ----------
  const before = await B.ev(`fetch('/api/orders',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.orders||d||[]).length).catch(()=>-1)`);
  await B.startCollect();
  const clicked = await B.ev(`(function(){
    var btns=Array.from(document.querySelectorAll('a,button'));
    var b=btns.find(x=>/Thanh toán ngay/i.test(x.innerText||''));
    if(!b) return null;
    b.click(); return {txt:b.innerText.trim(), href:b.getAttribute('href'), tag:b.tagName};
  })()`);
  await B.wait(6000);
  const payLog = B.stopCollect();
  const after = await B.ev(`fetch('/api/orders',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.orders||d||[]).length).catch(()=>-1)`);
  const payHash = await B.hash();
  const payTxt = String(await B.text());
  const payMemo = (payTxt.match(/MBK[A-Z0-9]{3,}/) || [])[0] || null;
  const payAmount = (payTxt.match(/([0-9]{1,3}(?:\.[0-9]{3}){1,2})\s*₫/) || [])[1] || null;

  R.ok(14, 'Nút "Thanh toán ngay" mở đúng QR của đơn đó', !!clicked && payMemo === qrInfo.memo,
    `clicked=${JSON.stringify(clicked)} hash=${payHash} memo=${payMemo} (gốc ${qrInfo.memo})`);
  R.ok('14b', '"Thanh toán ngay" KHÔNG tạo đơn mới', before === after && before > 0,
    `orders trước=${before} sau=${after}`);
  R.ok('14c', 'QR mở lại đúng số tiền', payAmount === '180.000', String(payAmount));
  R.ok('14d', 'Không có console error khi mở lại QR',
    payLog.console.filter((c) => c.type !== 'warning').length === 0,
    payLog.console.slice(0, 3).map((c) => c.text).join(' || '));
  await B.shot('B3-orders-pay-again', { clip: { x: 0, y: 0, width: 1440, height: 1150 } });

  // ---------- 15. /licenses ----------
  await B.startCollect();
  await B.goto('/licenses', 3500);
  const licLog = B.stopCollect();
  const licTxt = String(await B.text());
  R.ok(15, '/licenses render OK', licTxt.length > 120 && !/Mount error/i.test(licTxt),
    licTxt.slice(0, 250).replace(/\n/g, ' | '));
  R.ok('15b', '/licenses 0 console error', licLog.console.filter((c) => c.type !== 'warning').length === 0,
    licLog.console.slice(0, 3).map((c) => c.text).join(' || '));
  await B.shot('B4-licenses', { clip: { x: 0, y: 0, width: 1440, height: 1100 } });

  // ---------- 36b: nút "Tôi đã chuyển khoản" (spam guard) ----------
  await B.goto('/orders', 3000);
  const claimTest = await B.ev(`(async function(){
    var b=Array.from(document.querySelectorAll('a,button')).find(x=>/Thanh toán ngay/i.test(x.innerText||''));
    if(b) b.click();
    await new Promise(r=>setTimeout(r,5000));
    var c=document.querySelector('[data-claimed]');
    if(!c) return {err:'no claim btn', hash:location.hash};
    c.click();
    await new Promise(r=>setTimeout(r,2500));
    return {toasts:Array.from(document.querySelectorAll('.toast')).map(t=>t.innerText.trim()),
      status:(document.querySelector('#qr-status')||{}).innerText};
  })()`);
  R.info('36b', 'Nút "Tôi đã chuyển khoản" phản hồi', JSON.stringify(claimTest).slice(0, 400));

  const c = R.print();
  writeFileSync('_qa_shots/report-B.json', JSON.stringify({ ...c, state: STATE }, null, 2));
  console.log('USER TEST:', uname, '| ORDER:', STATE.orderId, '| MEMO:', qrInfo.memo);
  await B.close();
})();
