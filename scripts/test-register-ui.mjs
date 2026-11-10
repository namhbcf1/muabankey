const CDP = 'http://127.0.0.1:9222';
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
    if (r.exceptionDetails) return 'ERR:' + (r.exceptionDetails.exception?.description || '');
    return r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Đăng xuất trước
  await send('Page.navigate', { url: 'https://xienhl.com/#/' });
  await wait(2500);
  await ev(`fetch('/api/auth/logout', { method: 'POST' })`);
  await wait(800);

  console.log('\n🧪 ĐĂNG KÝ THẬT QUA UI\n');

  const uname = 'ui' + Math.random().toString(36).slice(2, 9);
  const pwd = 'abc123';

  await send('Page.navigate', { url: 'https://xienhl.com/#/register' });
  await wait(3200);

  // Điền form
  await ev(`(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    return JSON.stringify({
      u: set('#rg-user', '${uname}'),
      p: set('#rg-pwd', '${pwd}'),
      p2: set('#rg-pwd2', '${pwd}'),
    });
  })()`);

  await wait(400);
  const filled = await ev(`JSON.stringify({
    u: document.querySelector('#rg-user')?.value,
    p: document.querySelector('#rg-pwd')?.value ? '***' : '',
    p2: document.querySelector('#rg-pwd2')?.value ? '***' : '',
  })`);
  console.log('  Đã điền:', filled);

  // Submit
  await ev(`document.querySelector('#reg-submit')?.click()`);
  await wait(4000);

  const url = await ev('location.hash');
  const userChip = await ev(`document.querySelector('header')?.innerText?.slice(0, 80) || ''`);
  const isLoggedIn = await ev(`fetch('/api/auth/me', {credentials:'same-origin'}).then(r=>r.json()).then(d=>!!d.user)`);
  const userInfo = await ev(`fetch('/api/auth/me', {credentials:'same-origin'}).then(r=>r.json()).then(d=>JSON.stringify(d.user||{}))`);

  console.log('\n  Sau khi đăng ký:');
  console.log('    URL      :', url);
  console.log('    Đã login :', isLoggedIn ? '✅' : '❌');
  console.log('    User     :', userInfo);
  console.log('    Header   :', String(userChip).replace(/\n/g, ' | ').slice(0, 70));

  const parsed = JSON.parse(userInfo || '{}');
  const okAll = parsed.username === uname && parsed.email === null;

  console.log(`\n  ${okAll ? '✅' : '❌'} Đăng ký + đăng nhập tự động`);
  console.log(`     Tài khoản: ${uname} / ${pwd}`);

  // Thử mua hàng luôn
  await send('Page.navigate', { url: 'https://xienhl.com/#/wallet' });
  await wait(3000);
  const walletOk = await ev(`document.body.innerText.includes('Nạp tiền')`);
  console.log(`  ${walletOk ? '✅' : '❌'} Vào được trang nạp tiền`);

  ws.close();
  process.exit(okAll ? 0 : 1);
})();
