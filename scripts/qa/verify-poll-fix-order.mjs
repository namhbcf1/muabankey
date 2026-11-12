/** Kiểm chứng fix poll trên đường THỨ HAI: mở lại QR từ /orders ("Thanh toán ngay"). */
import { connect } from './harness.mjs';

const LOCAL = 'http://127.0.0.1:8788';

(async () => {
  const B = await connect();
  await B.viewport(1440, 900, false);
  await B.send('Page.bringToFront').catch(() => {});
  await B.send('Network.clearBrowserCache').catch(() => {});
  await B.send('Network.setCacheDisabled', { cacheDisabled: true });

  await B.send('Page.navigate', { url: LOCAL + '/#/login' });
  await B.wait(3000);
  await B.ev(`localStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.send('Page.navigate', { url: LOCAL + '/#/register' });
  await B.wait(3000);

  const u = 'ord' + Date.now().toString().slice(-8);
  await B.ev(`(function(){
    document.querySelector('#rg-user').value='${u}';
    document.querySelector('#rg-pwd').value='qaPass123';
    document.querySelector('#rg-pwd2').value='qaPass123';
    document.querySelector('#reg-submit').click(); return 1;
  })()`);
  await B.wait(4500);

  // tạo 1 đơn
  await B.send('Page.navigate', { url: LOCAL + '/#/product/license-xarena-thang' });
  await B.wait(3200);
  await B.ev(`document.querySelector('#btn-add-cart')?.click()`);
  await B.wait(1000);
  await B.send('Page.navigate', { url: LOCAL + '/#/checkout' });
  await B.wait(3200);
  await B.ev(`document.querySelector('#btn-place-order')?.click()`);
  await B.wait(6500);

  // sang /orders, bấm "Thanh toán ngay" -> route /order/<id> (mode order)
  await B.send('Page.navigate', { url: LOCAL + '/#/orders' });
  await B.wait(3500);
  const nOrdersBefore = await B.ev(`fetch('/api/orders',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.orders||[]).length).catch(()=>-1)`);
  await B.ev(`(function(){
    var b=Array.from(document.querySelectorAll('a,button')).find(x=>/Thanh toán ngay/i.test(x.innerText||''));
    if(b) b.click(); return !!b;
  })()`);
  await B.wait(6000);
  const hash = await B.ev('location.hash');
  const onQr = await B.ev(`!!document.querySelector('[data-qr-img]')`);
  const nOrdersAfter = await B.ev(`fetch('/api/orders',{credentials:'same-origin'}).then(r=>r.json()).then(d=>(d.orders||[]).length).catch(()=>-1)`);
  console.log('hash:', hash, '| QR hiện?', onQr, '| đơn trước/sau:', nOrdersBefore, '/', nOrdersAfter);

  // hook fetch rồi RỜI trang
  await B.ev(`(function(){
    window.__calls=[];
    var of=window.fetch;
    window.fetch=function(x){ window.__calls.push(String(x)); return of.apply(this,arguments); };
    return 1;
  })()`);
  await B.send('Page.navigate', { url: LOCAL + '/#/huong-dan' });
  await B.wait(1500);
  await B.ev(`window.__calls=[]; 1`);
  await B.wait(14000);
  const calls = await B.ev('window.__calls') || [];
  const polls = calls.filter((c) => /\/api\/orders\/[0-9a-f-]{36}$/.test(c));
  console.log('sau khi rời (mode order): tổng fetch', calls.length, '| poll order', polls.length);
  console.log('>>> ', polls.length === 0 ? '✅ HẾT RÒ RỈ (cả đường mở lại đơn)' : `❌ CÒN RÒ RỈ: ${JSON.stringify(calls.slice(0,5))}`);

  // dọn: xoá đơn + user test local
  await B.close();
})();
