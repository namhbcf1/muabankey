/** QA harness CDP — kết nối Chrome headless, thu thập console/network error, chụp ảnh. */
import { writeFileSync, mkdirSync } from 'node:fs';

export const CDP = 'http://127.0.0.1:9222';
export const BASE = process.env.QA_BASE || 'https://xienhl.com';
mkdirSync('shots', { recursive: true });
mkdirSync('_qa_shots', { recursive: true });

export async function connect() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const t = list.find((x) => x.type === 'page') || list[0];
  const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const q = pending.get(m.id); pending.delete(m.id);
      m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
      return;
    }
    for (const fn of listeners) fn(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description
        || r.exceptionDetails.text || 'unknown'));
    }
    return r.result?.value;
  };

  // ---- thu thập lỗi ----
  const log = { console: [], http: [], failed: [] };
  let collecting = false;
  listeners.push((m) => {
    if (!collecting) return;
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      log.console.push({
        type: m.params.type,
        text: m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400),
      });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      log.console.push({
        type: 'exception',
        text: (m.params.exceptionDetails.exception?.description
          || m.params.exceptionDetails.text || '').slice(0, 400),
      });
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) log.http.push({ status: r.status, url: r.url.slice(0, 220) });
    }
    if (m.method === 'Network.loadingFailed') {
      const p = m.params;
      if (p.blockedReason === 'inspector' || p.canceled) return;
      log.failed.push({ reason: p.errorText, type: p.type });
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Log.enable').catch(() => {});

  const api = {
    send, wait, ev, log, ws,
    startCollect() {
      log.console.length = 0; log.http.length = 0; log.failed.length = 0;
      collecting = true;
    },
    stopCollect() { collecting = false; return log; },
    async viewport(width, height, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
        screenWidth: width, screenHeight: height,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile }).catch(() => {});
    },
    async goto(hashOrUrl, settle = 2500) {
      const url = hashOrUrl.startsWith('http') ? hashOrUrl : BASE + '/#' + hashOrUrl.replace(/^#?\/?/, '/');
      await send('Page.navigate', { url });
      await wait(settle);
      return url;
    },
    async reload(settle = 2500) { await send('Page.reload', { ignoreCache: true }); await wait(settle); },
    async shot(name, opts = {}) {
      const params = { format: 'png', captureBeyondViewport: true };
      if (opts.clip) params.clip = { ...opts.clip, scale: 1 };
      const { data } = await send('Page.captureScreenshot', params);
      const p = 'shots/' + name + '.png';
      writeFileSync(p, Buffer.from(data, 'base64'));
      return p;
    },
    async text() { return String(await ev('document.body.innerText || ""')); },
    async hash() { return await ev('location.hash'); },
    async overflow() {
      return await ev(`(function(){
        var d=document.documentElement;
        var over=[];
        document.querySelectorAll('body *').forEach(function(el){
          var r=el.getBoundingClientRect();
          if(r.width===0&&r.height===0) return;
          if(r.right > d.clientWidth+1.5 || r.left < -1.5){
            var cs=getComputedStyle(el);
            if(cs.position==='fixed'||cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0') return;
            over.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,60),
              left:Math.round(r.left),right:Math.round(r.right),w:Math.round(r.width)});
          }
        });
        return {scrollW:d.scrollWidth, clientW:d.clientWidth,
          docOverflow: d.scrollWidth > d.clientWidth + 1, els: over.slice(0,12)};
      })()`);
    },
    async links() {
      return await ev(`(function(){
        var out=[];
        document.querySelectorAll('a[href]').forEach(function(a){
          var h=a.getAttribute('href');
          if(!h) return;
          out.push({href:h, text:(a.innerText||'').trim().slice(0,60),
            vis:a.getBoundingClientRect().width>0});
        });
        return out;
      })()`);
    },
    async close() { try { ws.close(); } catch {} },
  };
  return api;
}

export function mkReport(title) {
  const rows = [];
  let pass = 0, fail = 0, warn = 0;
  return {
    rows,
    ok(id, name, cond, detail = '') {
      if (cond) { pass++; rows.push([id, name, '✅ OK', detail]); }
      else { fail++; rows.push([id, name, '❌ LỖI', detail]); }
      return !!cond;
    },
    warn(id, name, detail = '') { warn++; rows.push([id, name, '⚠️ CẢNH BÁO', detail]); },
    info(id, name, detail = '') { rows.push([id, name, 'ℹ️', detail]); },
    print() {
      console.log('\n' + '='.repeat(78));
      console.log(title);
      console.log('='.repeat(78));
      for (const [id, name, res, detail] of rows) {
        console.log(`${String(id).padStart(3)} | ${res} | ${name}${detail ? '\n      → ' + detail : ''}`);
      }
      console.log('─'.repeat(78));
      console.log(`Tổng ${rows.length} | ✅ ${pass} | ❌ ${fail} | ⚠️ ${warn}`);
      console.log('='.repeat(78) + '\n');
      return { pass, fail, warn, rows };
    },
    get counts() { return { pass, fail, warn, total: rows.length }; },
  };
}
