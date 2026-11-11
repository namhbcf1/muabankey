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

  console.log('\n🛒 TEST UI SAU KHI BỎ VÍ\n');

  await send('Page.navigate', { url: B + '/' });
  await wait(5000);

  const body = String(await ev('document.body.innerText'));

  // 1. Menu không còn "Nạp tiền"
  const hasTopupMenu = body.includes('Nạp tiền');
  console.log(`  ${hasTopupMenu ? '❌' : '✅'} Menu "Nạp tiền" đã bỏ: ${hasTopupMenu ? 'CÒN' : 'OK'}`);

  // 2. Chip số dư đã bỏ
  const hasChip = await ev('!!document.querySelector("#balance-chip")');
  console.log(`  ${hasChip ? '❌' : '✅'} Chip số dư đã bỏ: ${hasChip ? 'CÒN' : 'OK'}`);

  // 3. Đăng ký user mới
  const uname = 'uiqr' + Date.now().toString().slice(-7);
  await send('Page.navigate', { url: B + '/#/register' });
  await wait(3500);
  await ev(`(function(){
    var u=document.querySelector('#rg-user'), p=document.querySelector('#rg-pwd'), p2=document.querySelector('#rg-pwd2');
    if(!u) return 0;
    u.value='${uname}'; p.value='abc123'; p2.value='abc123';
    ['input','change'].forEach(function(e){ u.dispatchEvent(new Event(e,{bubbles:true})); });
    document.querySelector('#reg-submit').click();
  })()`);
  await wait(4500);
  const logged = await ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?.username || null)`);
  console.log(`  ${logged === uname ? '✅' : '❌'} Đăng ký + đăng nhập: ${logged}`);

  // 4. Vào trang sản phẩm, mua ngay
  await send('Page.navigate', { url: B + '/#/products?category=license-xarena' });
  await wait(4000);

  // Tìm sản phẩm license
  const prodLink = await ev(`(function(){
    var a = document.querySelector('a[href*="/product/"]');
    return a ? a.getAttribute('href') : null;
  })()`);
  console.log(`  Sản phẩm: ${prodLink}`);

  if (prodLink) {
    await send('Page.navigate', { url: B + '/#' + prodLink });
    await wait(4000);

    // Bấm mua ngay
    const bought = await ev(`(function(){
      var b = document.querySelector('#btn-buy-now');
      if (b) { b.click(); return 'clicked'; }
      return 'notfound';
    })()`);
    console.log(`  Nút mua: ${bought}`);
    await wait(5000);

    const hash = await ev('location.hash');
    const pageTxt = String(await ev('document.body.innerText'));

    console.log(`  URL sau mua: ${hash}`);
    console.log(`  ${pageTxt.includes('Quét mã') || pageTxt.includes('QR') ? '✅' : '❌'} Hiện trang QR`);
    console.log(`  ${pageTxt.includes('MBK') ? '✅' : '❌'} Có nội dung CK MBK`);

    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1440, height: 1200, scale: 1 },
    });
    writeFileSync('shots/C0-qr-payment.png', Buffer.from(data, 'base64'));
    console.log('  📸 shots/C0-qr-payment.png');
  }

  ws.close();
})();
