// Minimal CDP client — no dependencies (Node >= 22 native WebSocket)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export async function launch({ port = 9333, headless = true, width = 1440, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'qa-chrome-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame',
    '--window-size=' + width + ',' + height,
    '--hide-scrollbars=false',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  const proc = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });

  // wait for /json/version
  let info = null;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { info = await r.json(); break; }
    } catch { /* retry */ }
    await sleep(150);
  }
  if (!info) throw new Error('Chrome did not start');

  return {
    port, proc, profile, info,
    async close() {
      try { proc.kill(); } catch { /* ignore */ }
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data || '')));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.handlers.get(msg.method);
        if (list) for (const fn of list) { try { fn(msg.params); } catch { /* ignore */ } }
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 60000);
    });
  }
}

export async function connect(port, wsUrl) {
  const url = wsUrl || (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
  });
  return new Session(ws);
}

/** Open a new page target and attach. Returns a Page helper. */
export async function newPage(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => browser.send(m, p, sessionId);

  const page = {
    targetId, sessionId, S,
    logs: [], errors: [], reqFailed: [], httpErrors: [],
    dialogs: [],
    clearLogs() { this.logs = []; this.errors = []; this.reqFailed = []; this.httpErrors = []; },
  };

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Log.enable');
  await S('Network.enable');

  await S('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  });
  if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  browser.on('Runtime.consoleAPICalled', (p) => {
    if (p.sessionId && p.sessionId !== sessionId) return;
  });
  // handlers are global on the browser socket; filter by sessionId in callback
  const withSid = (fn) => (p) => fn(p);

  browser.on('Runtime.consoleAPICalled', (p) => {
    if (p.sessionId !== sessionId) return;
    const text = (p.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? `[${a.type}]`).join(' ');
    page.logs.push({ type: p.type, text });
  });
  browser.on('Runtime.exceptionThrown', (p) => {
    if (p.sessionId !== sessionId) return;
    const d = p.exceptionDetails || {};
    page.errors.push({
      text: d.text,
      desc: d.exception?.description || d.exception?.value,
      url: d.url, line: d.lineNumber, col: d.columnNumber,
      stack: (d.stackTrace?.callFrames || []).slice(0, 4).map((f) => `${f.functionName || '(anon)'} @ ${f.url}:${f.lineNumber + 1}`),
    });
  });
  browser.on('Log.entryAdded', (p) => {
    if (p.sessionId !== sessionId) return;
    const e = p.entry;
    if (e.level === 'error' || e.level === 'warning') {
      page.logs.push({ type: 'log.' + e.level, text: `[${e.source}] ${e.text}${e.url ? ' @ ' + e.url : ''}` });
    }
  });
  browser.on('Network.loadingFailed', (p) => {
    if (p.sessionId !== sessionId) return;
    if (p.type === 'Fetch' || p.type === 'XHR' || p.type === 'Document' || p.type === 'Script' || p.type === 'Image') {
      page.reqFailed.push({ rid: p.requestId, type: p.type, err: p.errorText, canceled: p.canceled });
    }
  });
  browser.on('Network.responseReceived', (p) => {
    if (p.sessionId !== sessionId) return;
    const r = p.response;
    if (r.status >= 400) page.httpErrors.push({ status: r.status, url: r.url, type: p.type });
  });
  browser.on('Page.javascriptDialogOpening', async (p) => {
    if (p.sessionId !== sessionId) return;
    page.dialogs.push({ type: p.type, message: p.message });
    try { await S('Page.handleJavaScriptDialog', { accept: true }); } catch { /* ignore */ }
  });

  page.eval = async (expr, { awaitPromise = true, returnByValue = true } = {}) => {
    const r = await S('Runtime.evaluate', {
      expression: expr, awaitPromise, returnByValue, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  };

  page.goto = async (url, { waitUntil = 'networkIdle', timeout = 30000 } = {}) => {
    const done = new Promise((res) => {
      const h = setInterval(async () => {
        // polling readyState is more reliable than load events across SPA hash changes
        try {
          const st = await page.eval('document.readyState');
          if (st === 'complete') { clearInterval(h); res(); }
        } catch { /* keep polling */ }
      }, 200);
      setTimeout(() => { clearInterval(h); res(); }, timeout);
    });
    await S('Page.navigate', { url });
    await done;
    if (waitUntil === 'networkIdle') await page.waitIdle(1200);
    return page;
  };

  page.waitIdle = async (quietMs = 1200, maxMs = 15000) => {
    const t0 = Date.now();
    let last = Date.now();
    let prev = '';
    while (Date.now() - t0 < maxMs) {
      const sig = await page.eval(`(()=>{try{return document.body?document.body.innerHTML.length:'-1'}catch(e){return 'err'}})()`).catch(() => 'err');
      if (sig !== prev) { prev = sig; last = Date.now(); }
      if (Date.now() - last > quietMs) return;
      await sleep(150);
    }
  };

  page.waitFor = async (expr, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await page.eval(expr).catch(() => undefined);
      if (v) return v;
      await sleep(150);
    }
    return false;
  };

  page.screenshot = async (path, { fullPage = false } = {}) => {
    let clip;
    if (fullPage) {
      const m = await S('Page.getLayoutMetrics');
      const css = m.cssContentSize || m.contentSize;
      const h = Math.min(css.height, 6000);
      await S('Emulation.setDeviceMetricsOverride', { width, height: Math.ceil(h), deviceScaleFactor: 1, mobile });
      await sleep(250);
    }
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));
    if (fullPage) await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    return path;
  };

  page.close = async () => {
    try { await browser.send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  };

  return page;
}

export const PROD = 'https://xienhl.com';
