import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9405, headless: true, width: 1500, height: 950 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1500, height: 950 });

// login
await p.goto(PROD + '/#/login');
await p.waitFor(`!!document.querySelector('#password')`, 20000);
await sleep(600);
const loginRes = await p.eval(`(() => {
  const u = document.querySelector('#email') || document.querySelector('input[name=email]');
  const pw = document.querySelector('#password') || document.querySelector('input[name=password]');
  if (!u || !pw) return 'no-inputs';
  const setVal=(el,v)=>{const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
  setVal(u,'namhbcf');
  setVal(pw,'namhbcf123');
  const btn = document.querySelector('form button[type=submit]') || document.querySelector('form .btn-primary');
  if (!btn) return 'no-submit';
  btn.click();
  return 'submitted';
})()`);
console.log('login:', loginRes);
await sleep(4000);
const loggedIn = await p.eval(`(() => ({ hash: location.hash, isAdmin: /Quản trị hệ thống/.test(document.body.innerText) }))()`);
console.log('loggedIn:', JSON.stringify(loggedIn));
if (!loggedIn.isAdmin) { console.log('LOGIN FAILED - aborting'); await p.close(); await b.close(); process.exit(1); }

const tabs = ['dashboard','orders','topups','products','keys','licenses','trial','whitelist','users','settings','logs'];
const out = [];
for (const t of tabs) {
  p.clearLogs();
  const clicked = await p.eval(`(() => { const el=document.querySelector('[data-tab="${t}"]'); if(!el) return 'no-tab'; el.click(); return 'ok'; })()`);
  await sleep(2600);
  const info = await p.eval(`(() => {
    const main = document.querySelector('#admin-body, .admin-body, main, #app');
    const t = document.body.innerText;
    return {
      tab: ${JSON.stringify(t)},
      txtLen: t.length,
      jsErr: 0,
      hasError: /Đã có lỗi|Lỗi:|undefined|NaN|\\[object Object\\]|Không tải/i.test(t),
      errSample: (t.match(/(Đã có lỗi[^|\\n]{0,60}|undefined|NaN|\\[object Object\\]|Không tải[^\\n]{0,40})/g)||[]).slice(0,5),
      panel: (t.replace(/\\n+/g,' | ')).slice(0, 520),
      rows: document.querySelectorAll('tbody tr').length,
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input, select, textarea').length,
    };
  })()`);
  info.clicked = clicked;
  info.jsErrors = p.errors.length;
  info.jsErrDetail = p.errors.slice(0,3).map(e=>(e.desc||e.text||'').slice(0,200));
  info.httpErr = p.httpErrors.map(x=>x.status+' '+x.url.replace(PROD,'')).slice(0,5);
  out.push(info);
  console.log('### TAB', t, '| clicked:', clicked, '| txtLen:', info.txtLen, '| rows:', info.rows, '| jsErr:', info.jsErrors, '| httpErr:', JSON.stringify(info.httpErr));
  if (info.jsErrDetail.length) console.log('    JSERR:', JSON.stringify(info.jsErrDetail));
  console.log('    panel:', info.panel);
  console.log();
  await p.screenshot(`_qa_shots/admin-${t}.png`);
}

await p.close(); await b.close();
console.log('DONE');
