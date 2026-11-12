/** Kiểm chứng fix rò rỉ poll trên server LOCAL (127.0.0.1:8788) với code đã sửa. */
import { connect } from './harness.mjs';

const LOCAL = 'http://127.0.0.1:8788';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  await B.send('Network.clearBrowserCache').catch(() => {});

  await B.send('Page.navigate', { url: LOCAL + '/#/login' });
  await B.wait(3000);
  await B.ev(`localStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.send('Page.navigate', { url: LOCAL + '/#/register' });
  await B.wait(3000);

  const u = 'poll' + Date.now().toString().slice(-8);
  await B.ev(`(function(){
    document.querySelector('#rg-user').value='${u}';
    document.querySelector('#rg-pwd').value='qaPass123';
    document.querySelector('#rg-pwd2').value='qaPass123';
    document.querySelector('#reg-submit').click(); return 1;
  })()`);
  await B.wait(4500);
  const me = await B.ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?d.user.username:null).catch(()=>null)`);
  console.log('User local:', me);
  if (!me) { await B.close(); return; }

  // tạo đơn -> màn QR (đường click handler)
  await B.send('Page.navigate', { url: LOCAL + '/#/product/license-xarena-thang' });
  await B.wait(3200);
  await B.ev(`document.querySelector('#btn-add-cart')?.click()`);
  await B.wait(1200);
  await B.send('Page.navigate', { url: LOCAL + '/#/checkout' });
  await B.wait(3200);
  await B.ev(`document.querySelector('#btn-place-order')?.click()`);
  await B.wait(7000);
  const onQr = await B.ev('!!document.querySelector("[data-qr-img]")');
  console.log('Đang ở màn QR?', onQr);

  // hook fetch, rồi RỜI trang
  await B.ev(`(function(){
    window.__calls=[];
    var of=window.fetch;
    window.fetch=function(u){ window.__calls.push(String(u)); return of.apply(this,arguments); };
    return 1;
  })()`);
  await B.send('Page.navigate', { url: LOCAL + '/#/support' });
  await B.wait(1500);
  await B.ev(`window.__calls=[]; 1`);
  await B.wait(14000);

  const calls = await B.ev('window.__calls') || [];
  const orderPolls = calls.filter((c) => /\/api\/orders\/[0-9a-f-]{36}$/.test(c));
  console.log('\n=== SAU KHI RỜI MÀN QR (local, code đã sửa) ===');
  console.log('  tổng fetch trong 14s:', calls.length);
  console.log('  poll /api/orders/:id  :', orderPolls.length);
  console.log('  chi tiết:', JSON.stringify(calls.slice(0, 8)));
  console.log('\n>>> KẾT LUẬN:', orderPolls.length === 0 ? '✅ ĐÃ HẾT RÒ RỈ' : `❌ VẪN RÒ RỈ (${orderPolls.length} poll)`);

  // dọn user test local
  await B.close();
})();
