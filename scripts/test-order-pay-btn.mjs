import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });

const CDP = 'http://127.0.0.1:9222';
const B = 'https://xienhl.com';
let ws, id = 0;
const p = new Map();
const errs = [];

(async () => {
  const l = await (await fetch(CDP + '/json/list')).json();
  const t = l.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const q = p.get(m.id); p.delete(m.id);
      m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; p.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? 'ERR:' + (r.exceptionDetails.exception?.description || '') : r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => {
    if (c) { pass++; console.log(`  ✅ ${n}`); }
    else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
  };

  console.log('\n🔧 TEST P0-1: NÚT "THANH TOÁN NGAY"\n');

  // Đăng ký
  const uname = 'ord' + Date.now().toString().slice(-7);
  await send('Page.navigate', { url: B + '/#/register' });
  await wait(4000);
  await ev(`(function(){
    var u=document.querySelector('#rg-user'), p=document.querySelector('#rg-pwd'), p2=document.querySelector('#rg-pwd2');
    if(!u) return 0;
    u.value='${uname}'; p.value='abc123'; p2.value='abc123';
    u.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#reg-submit').click();
  })()`);
  await wait(5000);

  // Tạo đơn 70k (gói tuần)
  const made = await ev(`(async()=>{
    const r = await fetch('/api/orders', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({items:[{productId:'p-lic-week', quantity:1}]})
    });
    const d = await r.json();
    return d.ok ? {id: d.order.id, code: d.order.code, total: d.order.total} : {err: JSON.stringify(d)};
  })()`);
  console.log(`  Đơn tạo: ${JSON.stringify(made)}`);
  if (!made?.id) { console.log('  ❌ không tạo được đơn'); ws.close(); return; }

  // Thêm món vào giỏ để test bẫy "tạo đơn mới sai giá"
  await ev(`(async()=>{
    await fetch('/api/cart-ping', {credentials:'same-origin'}).catch(()=>{});
    localStorage.setItem('mbk_cart', JSON.stringify([{productId:'p-lic-year', quantity:2}]));
  })()`);

  // Mở trang đơn hàng
  await send('Page.navigate', { url: B + '/#/orders' });
  await wait(4500);

  const hasPayBtn = await ev(`!!document.querySelector('[data-pay="${made.id}"]')`);
  ok('có nút "Thanh toán ngay"', hasPayBtn);

  if (!hasPayBtn) {
    console.log('  body:', String(await ev('document.body.innerText')).slice(0, 250).replace(/\n/g, ' | '));
    ws.close(); return;
  }

  // Bấm nút
  await ev(`document.querySelector('[data-pay="${made.id}"]').click()`);
  await wait(7000);

  const hash = await ev('location.hash');
  const txt = String(await ev('document.body.innerText'));
  const memo = await ev(`(document.body.innerText.match(/MBK[A-Z0-9]{4,}/) || [])[0] || null`);
  const amounts = await ev(`(document.body.innerText.match(/\\d{1,3}(?:\\.\\d{3})+\\s*₫/g) || [])`);

  console.log(`  URL: ${hash}`);
  console.log(`  Mã CK hiện: ${memo}`);
  console.log(`  Số tiền hiện: ${JSON.stringify(amounts?.slice(0, 3))}`);
  console.log(`  Đơn gốc: ${made.code} — ${made.total}đ`);

  ok('URL là /order/:id', hash.includes('/order/'), hash);
  ok('memo đúng đơn gốc', memo && memo.replace(/[^A-Z0-9]/g, '') === made.code.replace(/-/g, ''),
    `${memo} vs ${made.code}`);
  ok('KHÔNG tạo đơn mới sai giá',
    !txt.includes('2.060.000') && !txt.includes('2.060.000₫'),
    'thấy giá giỏ hàng');
  ok('số tiền = đơn gốc', String(amounts?.[0] || '').includes('70.000'),
    String(amounts?.[0]));

  // Kiểm tra server: chỉ có 1 đơn
  const orders = await ev(`fetch('/api/orders?perPage=20',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.orders||[]).length)`);
  ok('không sinh đơn mới', orders === 1, `${orders} đơn`);

  if (errs.length) {
    console.log('\n  Lỗi JS:');
    errs.slice(0, 3).forEach((e) => console.log('   • ' + String(e).slice(0, 150)));
  }

  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: 1200, scale: 1 },
  });
  writeFileSync('shots/C2-order-qr-fix.png', Buffer.from(data, 'base64'));
  console.log('  📸 shots/C2-order-qr-fix.png');

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  ws.close();
})();
