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
  await send('Page.navigate', { url: 'https://xienhl.com/#/register' });
  await wait(3800);

  console.log('\n🔍 FORM ĐĂNG KÝ\n');

  const checks = [
    ['Ô tài khoản (#rg-user)', '#rg-user', true],
    ['Ô nhập lại mật khẩu (#rg-pwd2)', '#rg-pwd2', true],
    ['Ô mật khẩu (#rg-pwd)', '#rg-pwd', true],
    ['Đã bỏ ô Email (#rg-email)', '#rg-email', false],
    ['Đã bỏ ô Họ tên (#rg-name)', '#rg-name', false],
    ['Đã bỏ ô Số điện thoại (#rg-phone)', '#rg-phone', false],
  ];

  for (const [label, sel, shouldExist] of checks) {
    const exists = await ev(`!!document.querySelector('${sel}')`);
    const good = exists === shouldExist;
    console.log(`  ${good ? '✅' : '❌'} ${label}: ${exists ? 'có' : 'không'}`);
  }

  const body = await ev('document.body.innerText');
  console.log('\n  --- Text trên trang ---');
  console.log('  ' + String(body).split('\n').filter((x) => x.trim()).slice(0, 14).join('\n  '));

  const hint6 = String(body).includes('6 ký tự');
  console.log(`\n  ${hint6 ? '✅' : '❌'} Ghi rõ "6 ký tự"`);

  ws.close();
})();
