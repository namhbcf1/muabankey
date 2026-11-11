import { launch, connect, newPage, sleep, PROD } from './qa/cdp.mjs';

const b = await launch({ port: 9401, headless: true, width: 1440, height: 900 });
const s = await connect(b.port);
const p = await newPage(s, { width: 1440, height: 900 });

await p.goto(PROD + '/');
await p.waitIdle(1500);

const trialInfo = await p.eval(`(() => {
  const sec = document.querySelector('#trial-section');
  const btns = [...document.querySelectorAll('[data-trial-kind]')].map(x=>({kind:x.dataset.trialKind, text:x.textContent.trim(), visible:!!x.offsetParent}));
  return { sectionExists: !!sec, sectionVisible: sec ? !!sec.offsetParent : false,
    trialNameTexts: [...document.querySelectorAll('.trial-name')].map(e=>e.textContent.trim()),
    buttons: btns, bodyLen: document.body.innerHTML.length };
})()`);
console.log('A1 trial section:', JSON.stringify(trialInfo, null, 2));

await p.screenshot('_qa_shots/01-home.png', { fullPage: false });

const statsTxt = await p.eval(`(() => {
  const t = document.body.innerText;
  return { hasUpdating: /Đang cập nhật/i.test(t), head: t.slice(0,900) };
})()`);
console.log('A-stats on home:', JSON.stringify(statsTxt, null, 1));

const clicked = await p.eval(`(() => { const x=document.querySelector('[data-trial-kind="1h"]'); if(!x) return 'no-btn'; x.click(); return 'clicked'; })()`);
console.log('A2 click:', clicked);
await sleep(2500);
const modal1 = await p.eval(`(() => {
  const all = document.body.innerText;
  const m = document.querySelector('[role="dialog"], .modal, .modal-box, #modal');
  return {
    modalEl: m ? (m.className||m.id) : null,
    hasCurl: /curl\\s+-L/i.test(all),
    hasTrialKey: /--trial-key/i.test(all),
    hasCmdUrl: /\\/i\\/TR-/.test(all),
    bodyLen: all.length,
    excerpt: all.slice(0, 2000)
  };
})()`);
console.log('A2 modal:', JSON.stringify(modal1, null, 2));
await p.screenshot('_qa_shots/02-trial-modal.png', { fullPage: false });

console.log('--- console logs:', JSON.stringify(p.logs.slice(0,20), null, 1));
console.log('--- js errors:', JSON.stringify(p.errors.slice(0,10), null, 1));
console.log('--- http errors:', JSON.stringify(p.httpErrors.slice(0,10), null, 1));

await p.close(); await b.close();
