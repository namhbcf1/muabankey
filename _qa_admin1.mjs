import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9404, headless: true, width: 1500, height: 950 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1500, height: 950 });

await p.goto(PROD + '/#/login');
await sleep(1800);

// fill login form (username field is type=text name=email)
const filled = await p.eval(`(() => {
  const u = document.querySelector('input#email, input[name=email]');
  const pw = document.querySelector('input#password, input[name=password]');
  if (!u || !pw) return 'no-inputs';
  const setVal = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setVal(u, 'namhbcf');
  setVal(pw, 'namhbcf123');
  return { u: u.value, pwLen: pw.value.length };
})()`);
console.log('fill:', JSON.stringify(filled));

await p.eval(`(() => { const f=document.querySelector('form'); f.querySelector('button[type=submit], button.btn-primary').click(); return 1; })()`);
await sleep(4000);

const afterLogin = await p.eval(`(() => ({
  hash: location.hash,
  text: document.body.innerText.replace(/\\n+/g,' | ').slice(0,300),
  hasLogout: /Đăng xuất|Thoát/i.test(document.body.innerText),
  userMenu: !!document.querySelector('[data-user-menu], .user-menu'),
}))()`);
console.log('AFTER LOGIN:', JSON.stringify(afterLogin, null, 1));
console.log('jsErrors:', JSON.stringify(p.errors.slice(0,5)));

// check /api/auth/me
const me = await p.eval(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.json())`);
console.log('ME:', JSON.stringify(me));

// navigate admin
await p.goto(PROD + '/#/admin');
await sleep(3000);
const adminRoot = await p.eval(`(() => ({
  hash: location.hash,
  text: document.body.innerText.replace(/\\n+/g,' | ').slice(0,500),
  tabs: [...document.querySelectorAll('[data-tab], .tab, [role=tab]')].map(t=>({t:t.textContent.trim().slice(0,30), v:t.dataset.tab})).slice(0,30)
}))()`);
console.log('ADMIN:', JSON.stringify(adminRoot, null, 1));
console.log('jsErrors:', JSON.stringify(p.errors.slice(0,5)));
await p.screenshot('_qa_shots/admin-dash.png');

await p.close(); await b.close();
