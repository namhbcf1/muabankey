/**
 * Mua license thật qua trình duyệt, chụp màn hình nhận key + lệnh CMD.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'https://muabankey.bangachieu2.workers.dev';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let ws, msgId = 0;
const pending = new Map();
const errs = [];

async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page');
  ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(m.params.exceptionDetails.text);
    }
  };
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
}
async function shot(name, full = true) {
  let params = { format: 'png' };
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    params = {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(cssContentSize.width, 1440), height: Math.min(cssContentSize.height, 5200), scale: 1 },
    };
  }
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  📸 ${OUT}/${name}.png`);
}
async function goto(hash, ms = 2600) {
  await send('Page.navigate', { url: BASE + '/#' + hash });
  await wait(ms);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Đảm bảo đủ tiền
  console.log('\n💰 Nạp tiền cho demo');
  await goto('/login');
  await ev(`(()=>{const e=document.querySelector('#lg-email'),p=document.querySelector('#lg-pwd');
    e.value='demo@muabankey.vn';p.value='Demo@123456';
    e.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 1;})()`);
  await wait(3000);
  console.log('  me:', await ev(`(async()=>{const d=await (await fetch('/api/auth/me')).json();return d.user?d.user.email+' bal='+d.user.balance:'anon';})()`));

  const bal = await ev(`(async()=>{const d=await (await fetch('/api/auth/me')).json();return d.user?.balance||0;})()`);
  if (bal < 500000) {
    const top = await ev(`(async()=>{const r=await fetch('/api/wallet/topup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:2000000})});const d=await r.json();return d.topup?d.topup.code:'ERR';})()`);
    console.log('  topup code:', top);
    console.log('  (cần webhook để cộng tiền — dùng key AOE1THANG đã có sẵn để test UI)');
  }

  // 2. Mua gói tuần
  console.log('\n🛒 Mua gói Tuần');
  await goto('/product/license-xarena-tuan');
  await ev(`(()=>{const b=document.querySelector('#btn-add-cart'); if(b){b.click();return 1;} return 0;})()`);
  await wait(1200);
  await goto('/checkout', 3000);
  await shot('30-checkout-license');
  console.log('  tại checkout, tổng:', await ev(`document.querySelector('#sum-total')?.textContent`));

  const place = await ev(`(()=>{const b=document.querySelector('#btn-place-order'); if(b){b.click();return 1;} return 0;})()`);
  console.log('  bấm đặt hàng:', place);
  await wait(5000);

  const bodyTxt = await ev(`document.body.innerText.slice(0,600)`);
  console.log('  --- trang hiện tại ---');
  console.log('  ' + bodyTxt.replace(/\n+/g, '\n  ').slice(0, 700));

  await shot('31-checkout-success');

  // 3. Trang License của tôi
  console.log('\n🔑 License của tôi');
  await goto('/licenses', 3200);
  await shot('32-my-license-with-cmd');

  const cmd = await ev(`(()=>{const el=document.querySelector('[id^="cmd-"]'); return el?el.textContent.trim():'NOT FOUND';})()`);
  console.log('  Lệnh CMD hiển thị:');
  console.log('  ' + cmd);

  console.log('\n  exceptions:', errs.length);
  ws.close();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
