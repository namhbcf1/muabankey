/**
 * Kiểm chứng tương tác trên trang quản trị.
 *
 * Mở hộp thoại của các luồng nguy hiểm (duyệt nạp, điều chỉnh số dư, sửa sản
 * phẩm, thu hồi license) để chắc markup mới vẫn giữ nguyên id/data-* mà JS bám
 * vào và mọi luồng xác nhận vẫn còn. KHÔNG bấm nút xác nhận cuối.
 *
 * node scripts/verify-admin-flows.mjs <baseUrl> <cookie>
 */
const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const COOKIE = process.argv[3] || '';

let ws; let id = 0; const p = new Map();
let errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; p.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});

const created = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const targetId = created.id;
ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.id && p.has(m.id)) {
    const q = p.get(m.id); p.delete(m.id);
    m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
  }
};
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  }
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: BASE + '/#/' });
await sleep(700);
const eq = COOKIE.indexOf('=');
await send('Network.setCookie', {
  name: COOKIE.slice(0, eq), value: COOKIE.slice(eq + 1), url: BASE + '/', path: '/',
});
await send('Page.navigate', { url: 'about:blank' });
await sleep(250);

const goto = async (tab) => {
  await send('Page.navigate', { url: `${BASE}/#/admin?tab=${tab}` });
  await sleep(2200);
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const closeModal = async () => {
  await ev(`document.querySelector('.modal-overlay.open [data-cancel]')?.click()`);
  await sleep(350);
};

/* ---------- 1. Đơn hàng ---------- */
await goto('orders');
{
  const o = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    return JSON.stringify({
      rows: c.querySelectorAll('tbody tr').length,
      deliver: c.querySelectorAll('[data-deliver]').length,
      refund: c.querySelectorAll('[data-refund]').length,
      pills: [...c.querySelectorAll('tbody .pill')].map(e => e.textContent.trim()),
      thScope: [...c.querySelectorAll('th')].every(e => e.getAttribute('scope') === 'col'),
      filterLabel: !!c.querySelector('label[for="order-status-filter"]'),
    });
  })()`));
  check('Đơn hàng: hàng dữ liệu render', o.rows > 0, `${o.rows} hàng`);
  check('Đơn hàng: mọi <th> có scope="col"', o.thScope);
  check('Đơn hàng: nhãn trạng thái đã Việt hoá',
    o.pills.every((s) => !/^(pending|paid|delivered|cancelled|refunded)$/.test(s)),
    o.pills.join(' | '));
  check('Đơn hàng: bộ lọc có label ẩn cho trình đọc màn hình', o.filterLabel);
}

/* ---------- 2. Nạp tiền: modal duyệt ---------- */
await goto('topups');
{
  const hasApprove = await ev(`!!document.querySelector('[data-approve]')`);
  if (hasApprove) {
    await ev(`document.querySelector('[data-approve]').click()`);
    await sleep(500);
    const md = JSON.parse(await ev(`(() => {
      const m = document.querySelector('.modal-overlay.open .modal');
      if (!m) return JSON.stringify({ open: false });
      return JSON.stringify({
        open: true,
        title: m.querySelector('.modal-title')?.textContent.trim(),
        hasAmt: !!m.querySelector('#ap-amt'), hasNote: !!m.querySelector('#ap-note'),
        amtValue: m.querySelector('#ap-amt')?.value,
        labels: [...m.querySelectorAll('label.label')].map(l => l.getAttribute('for')),
        icons: m.querySelectorAll('svg.i').length,
        cancel: !!m.querySelector('[data-cancel]'), ok: !!m.querySelector('[data-ok]'),
      });
    })()`));
    check('Nạp tiền: mở được modal duyệt', md.open === true, md.title || '');
    check('Nạp tiền: giữ #ap-amt và #ap-note', md.hasAmt && md.hasNote);
    check('Nạp tiền: ô số tiền tự điền từ data-amt', !!md.amtValue, `value=${md.amtValue}`);
    check('Nạp tiền: label trỏ đúng input',
      (md.labels || []).every((f) => f === 'ap-amt' || f === 'ap-note'), JSON.stringify(md.labels));
    check('Nạp tiền: nút dùng icon SVG, không emoji', md.icons > 0);
    check('Nạp tiền: còn [data-cancel] và [data-ok]', md.cancel && md.ok);
    await closeModal();
  } else {
    check('Nạp tiền: không có lệnh chờ', true, 'bỏ qua (dữ liệu rỗng)');
  }
}

/* ---------- 3. Sản phẩm: modal sửa ---------- */
await goto('products');
{
  await ev(`document.querySelector('[data-edit]')?.click()`);
  await sleep(600);
  const m = JSON.parse(await ev(`(() => {
    const m = document.querySelector('.modal-overlay.open .modal');
    if (!m) return JSON.stringify({ open: false });
    const ids = ['ed-name','ed-cat','ed-short','ed-desc','ed-img','ed-price','ed-cprice',
                 'ed-warranty','ed-duration','ed-badge','ed-features','ed-delivery',
                 'ed-licprefix','ed-licdays','ed-active','ed-featured'];
    return JSON.stringify({
      open: true,
      missing: ids.filter((i) => !m.querySelector('#' + i)),
      unlabeled: [...m.querySelectorAll('label.label')].filter(l => !l.getAttribute('for')).length,
      hasSave: !!m.querySelector('[data-save]'), hasCancel: !!m.querySelector('[data-cancel]'),
    });
  })()`));
  check('Sản phẩm: mở được modal sửa', m.open === true);
  check('Sản phẩm: đủ 16 id mà JS đọc', m.missing.length === 0, m.missing.join(','));
  check('Sản phẩm: mọi label.label có for', m.unlabeled === 0, `${m.unlabeled} thiếu`);
  check('Sản phẩm: còn [data-save]/[data-cancel]', m.hasSave && m.hasCancel);
  await closeModal();
}

/* ---------- 4. Người dùng ---------- */
await goto('users');
{
  const u = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    const btns = [...c.querySelectorAll('tbody button')];
    return JSON.stringify({
      allLabeled: btns.every(b => b.getAttribute('aria-label')),
      labels: btns.slice(0, 2).map(b => b.getAttribute('aria-label')),
      adj: c.querySelectorAll('[data-adj]').length,
      lock: c.querySelectorAll('[data-lock]').length,
      icons: c.querySelectorAll('tbody svg.i').length,
    });
  })()`));
  check('Người dùng: nút biểu tượng đều có aria-label', u.allLabeled, u.labels.join(' / '));
  check('Người dùng: có [data-adj] và [data-lock]', u.adj > 0 && u.lock > 0, `adj=${u.adj} lock=${u.lock}`);
  check('Người dùng: nút là icon SVG', u.icons > 0, `${u.icons} icon`);

  await ev(`document.querySelector('[data-adj]')?.click()`);
  await sleep(500);
  const a = JSON.parse(await ev(`(() => {
    const m = document.querySelector('.modal-overlay.open .modal');
    if (!m) return JSON.stringify({ open: false });
    return JSON.stringify({ open: true,
      hasAmt: !!m.querySelector('#adj-amount'), hasReason: !!m.querySelector('#adj-reason'),
      ok: !!m.querySelector('[data-ok]'), cancel: !!m.querySelector('[data-cancel]') });
  })()`));
  check('Người dùng: mở modal điều chỉnh số dư', a.open === true);
  check('Người dùng: giữ #adj-amount/#adj-reason + nút', a.hasAmt && a.hasReason && a.ok && a.cancel);
  await closeModal();
}

/* ---------- 5. Trial: modal reset (luồng nhiều bước) ---------- */
await goto('trial');
{
  const hasReset = await ev(`!!document.querySelector('[data-reset]')`);
  if (hasReset) {
    await ev(`document.querySelector('[data-reset]').click()`);
    await sleep(500);
    const r = JSON.parse(await ev(`(() => {
      const m = document.querySelector('.modal-overlay.open .modal');
      if (!m) return JSON.stringify({ open: false });
      return JSON.stringify({ open: true,
        kinds: !!m.querySelector('#rs-kinds'), reason: !!m.querySelector('#rs-reason'),
        revoke: !!m.querySelector('#rs-revoke'), ok: !!m.querySelector('[data-ok]'),
        revokeDefault: m.querySelector('#rs-revoke')?.checked,
        warn: !!m.querySelector('.alert-warn'),
        checks: m.querySelectorAll('input[type=checkbox]').length });
    })()`));
    check('Trial: mở modal reset', r.open === true);
    check('Trial: giữ #rs-kinds/#rs-reason/#rs-revoke', r.kinds && r.reason && r.revoke);
    check('Trial: ô thu hồi mặc định bật', r.revokeDefault === true);
    check('Trial: còn cảnh báo nghiệp vụ', r.warn === true);
    await closeModal();
  } else {
    check('Trial: không có tài khoản đã dùng để reset', true, 'bỏ qua (dữ liệu rỗng)');
  }
}

/* ---------- 6. License ---------- */
await goto('licenses');
{
  const l = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    return JSON.stringify({
      stats: c.querySelectorAll('.stat-card').length,
      rows: c.querySelectorAll('tbody tr').length,
      emptyRow: !!c.querySelector('.adm-empty'),
      createForm: !!c.querySelector('#lc-create'),
      search: !!c.querySelector('#lc-q'),
      revokeCount: c.querySelectorAll('[data-act="revoke"]').length,
      icons: c.querySelectorAll('svg.i').length,
    });
  })()`));
  check('License: 6 thẻ thống kê', l.stats === 6, `${l.stats} thẻ`);
  check('License: còn form tạo + ô tìm', l.createForm && l.search);
  check('License: rỗng thì hiện dòng trống, không vỡ bảng',
    l.rows > 0 ? true : l.emptyRow, `rows=${l.rows} empty=${l.emptyRow}`);
  check('License: dùng icon SVG', l.icons > 0, `${l.icons} icon`);

  if (l.revokeCount > 0) {
    await ev(`document.querySelector('[data-act="revoke"]').click()`);
    await sleep(500);
    const c2 = JSON.parse(await ev(`(() => {
      const m = document.querySelector('.modal-overlay.open .modal');
      if (!m) return JSON.stringify({ open: false });
      return JSON.stringify({ open: true,
        title: m.querySelector('.modal-title')?.textContent.trim(),
        yes: !!m.querySelector('[data-yes]'), no: !!m.querySelector('[data-no]') });
    })()`));
    check('License: thu hồi vẫn bắt xác nhận', c2.open && c2.yes && c2.no, c2.title);
    await ev(`document.querySelector('.modal-overlay.open [data-no]')?.click()`);
    await sleep(350);
  } else {
    check('License: không có license để thu hồi', true, 'bỏ qua');
  }
}

/* ---------- 7. Cài đặt ---------- */
await goto('settings');
{
  const s = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    const ids = ['st-bank','st-acc','st-owner','st-min','st-max',
                 'wh-sepay-url','wh-payos-url','wh-payos-key','wh-save-payos','wh-clear-payos',
                 'tg-token','tg-chat','tg-save','tg-test','tg-clear','tg-webhook-url'];
    const typed = ['wh-sepay-url','wh-payos-url','tg-webhook-url'];
    return JSON.stringify({
      missing: ids.filter(i => !document.getElementById(i)),
      copyButtons: typed.every(i => {
        const e = document.getElementById(i);
        return e && e.tagName === 'BUTTON' && e.getAttribute('aria-label');
      }),
      form: !!document.getElementById('settings-form'),
      unlabeled: [...c.querySelectorAll('label.label')].filter(l => !l.getAttribute('for')).length,
      providers: c.querySelectorAll('.adm-provider').length,
      status: !!c.querySelector('#wh-status'),
      tgBadge: !!c.querySelector('#tg-badge'),
    });
  })()`));
  check('Cài đặt: đủ mọi id mà JS đọc', s.missing.length === 0, s.missing.join(','));
  check('Cài đặt: form lưu còn nguyên', s.form === true);
  check('Cài đặt: URL copy là <button> có aria-label', s.copyButtons === true);
  check('Cài đặt: mọi label.label có for', s.unlabeled === 0, `${s.unlabeled} thiếu`);
  check('Cài đặt: 3 khối dịch vụ webhook', s.providers === 3, `${s.providers} khối`);
  check('Cài đặt: còn ô trạng thái webhook + badge Telegram', s.status && s.tgBadge);
}

/* ---------- 8. Tổng quan / Nhật ký / Kho key ---------- */
await goto('dashboard');
{
  const d = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    const styled = [...c.querySelectorAll('[style]')];
    return JSON.stringify({
      stats: c.querySelectorAll('.stat-card').length,
      panels: c.querySelectorAll('.panel').length,
      bars: c.querySelectorAll('.bar-row').length,
      recent: c.querySelectorAll('.adm-recent-row').length,
      styles: styled.map(e => e.getAttribute('style')),
      hosts: styled.map(e => e.tagName.toLowerCase() + '.' +
        ((typeof e.className === 'string' ? e.className : e.className.baseVal) || '')),
    });
  })()`));
  check('Tổng quan: 6 thẻ thống kê + 2 panel', d.stats === 6 && d.panels === 2, `${d.stats}/${d.panels}`);
  // Toàn bộ inline style còn lại phải là width động của bar-fill.
  check('Tổng quan: inline style chỉ còn width của bar-fill',
    d.styles.every((x) => /^width:\s*\d+(\.\d+)?%$/.test(x.trim())),
    `hosts=${JSON.stringify(d.hosts)}`);
}

await goto('logs');
{
  const l = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    return JSON.stringify({ rows: c.querySelectorAll('tbody tr').length,
      th: c.querySelectorAll('th').length,
      thScope: [...c.querySelectorAll('th')].every(e => e.getAttribute('scope') === 'col') });
  })()`));
  check('Nhật ký: bảng render đủ 4 cột', l.th === 4 && l.thScope, `${l.rows} hàng`);
}

await goto('keys');
{
  const k = JSON.parse(await ev(`(() => {
    const c = document.getElementById('admin-content');
    return JSON.stringify({
      select: !!document.getElementById('key-product'),
      label: !!c.querySelector('label[for="key-product"]'),
      options: c.querySelectorAll('#key-product option').length,
    });
  })()`));
  check('Kho key: ô chọn sản phẩm có label', k.select && k.label);
  check('Kho key: danh sách sản phẩm đã nạp', k.options > 1, `${k.options} lựa chọn`);
}

/* ---------- Tổng kết ---------- */
const failed = results.filter((r) => !r.ok);
const jsErr = errors.filter((e) => !/favicon|ResizeObserver/i.test(e || ''));
console.log('\n================ FLOW REPORT ================');
console.log(`Tổng kiểm tra : ${results.length}`);
console.log(`Đạt           : ${results.length - failed.length}`);
console.log(`Không đạt     : ${failed.length}`);
if (failed.length) failed.forEach((f) => console.log(`  ✗ ${f.name} — ${f.detail}`));
console.log(`Lỗi JS        : ${jsErr.length}`);
if (jsErr.length) jsErr.slice(0, 5).forEach((e) => console.log('  ' + String(e).split('\n')[0]));
ws.close();
await fetch(CDP + '/json/close/' + targetId).catch(() => {});
process.exitCode = failed.length || jsErr.length ? 1 : 0;
