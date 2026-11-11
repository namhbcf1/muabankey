import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });

const CDP = 'http://127.0.0.1:9222';
const B = 'https://xienhl.com';
let ws, id = 0;
const p = new Map();

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

  console.log('\n🛒 LUỒNG MUA QR ĐẦY ĐỦ\n');

  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => {
    if (c) { pass++; console.log(`  ✅ ${n}`); }
    else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
  };

  // 1. Đăng ký
  const uname = 'flow' + Date.now().toString().slice(-7);
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
  const me = await ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?.username||null)`);
  ok('đăng ký + đăng nhập', me === uname, String(me));

  // 2. Menu không còn "Nạp tiền"
  const navTxt = String(await ev(`document.querySelector('header')?.innerText || ''`));
  ok('menu không còn "Nạp tiền"', !navTxt.includes('Nạp tiền'), navTxt.slice(0, 60));

  // 3. Trang sản phẩm license
  await send('Page.navigate', { url: B + '/#/product/license-xarena-thang' });
  await wait(4500);

  const hasBuy = await ev(`!!document.querySelector('#btn-buy-now')`);
  ok('có nút Mua ngay', hasBuy);

  if (!hasBuy) {
    console.log('  body:', String(await ev('document.body.innerText')).slice(0, 200).replace(/\n/g, ' | '));
    ws.close();
    return;
  }

  // 4. Bấm mua -> trang checkout
  await ev(`document.querySelector('#btn-buy-now').click()`);
  await wait(5000);

  // 4b. Bấm "Xác nhận thanh toán" -> tạo đơn + hiện QR
  const hasPlace = await ev(`!!document.querySelector('#btn-place-order')`);
  ok('có nút Xác nhận thanh toán', hasPlace);
  if (hasPlace) {
    await ev(`document.querySelector('#btn-place-order').click()`);
    await wait(8000);
  }

  const hash = await ev('location.hash');
  const pageTxt = String(await ev('document.body.innerText'));

  console.log(`  URL: ${hash}`);
  ok('chuyển sang trang thanh toán', hash.includes('/order/') || pageTxt.includes('Quét mã'),
    hash);

  // 5. Kiểm tra QR
  const hasQrImg = await ev(`!!document.querySelector('[data-qr-img]')`);
  const memo = await ev(`(function(){
    var el = document.body.innerText.match(/MBK[A-Z0-9]{4,}/);
    return el ? el[0] : null;
  })()`);
  const amount = await ev(`(function(){
    var el = document.body.innerText.match(/(\\d{1,3}(?:\\.\\d{3})+)\\s*₫/);
    return el ? el[1] : null;
  })()`);

  ok('có ảnh QR', hasQrImg);
  ok('có nội dung MBK', !!memo, String(memo));
  ok('có số tiền', !!amount, String(amount));

  if (memo) console.log(`  Mã CK: ${memo}`);
  if (amount) console.log(`  Số tiền: ${amount}₫`);

  // 6. Có nút "Tôi đã chuyển khoản"
  const hasClaim = await ev(`!!document.querySelector('[data-claimed]')`);
  ok('có nút "Tôi đã chuyển khoản"', hasClaim);

  // 7. Có đếm ngược
  const countdown = await ev(`document.querySelector('#qr-countdown')?.textContent || ''`);
  ok('có đếm ngược', /\d{2}:\d{2}/.test(String(countdown)), String(countdown));

  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: 1300, scale: 1 },
  });
  writeFileSync('shots/C1-qr-payment-real.png', Buffer.from(data, 'base64'));
  console.log('  📸 shots/C1-qr-payment-real.png');

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tổng: ${pass + fail}  |  ✅ ${pass}  |  ❌ ${fail}`);
  ws.close();
})();
