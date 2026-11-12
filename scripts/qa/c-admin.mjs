/** QA C — trang admin: đăng nhập, từng tab, kiểm lỗi ngày 1970 + cột Số dư. */
import { connect, mkReport } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const TABS = [
  ['dashboard', 'Tổng quan'],
  ['topups', 'Chờ thanh toán'],
  ['orders', 'Đơn hàng'],
  ['products', 'Sản phẩm'],
  ['keys', 'Kho key'],
  ['licenses', 'License'],
  ['trial', 'Dùng thử'],
  ['whitelist', 'Vô hạn'],
  ['users', 'Người dùng'],
  ['settings', 'Cài đặt'],
  ['logs', 'Nhật ký'],
];

(async () => {
  const B = await connect();
  const R = mkReport('PHẦN C — TRANG ADMIN');
  await B.viewport(1440, 1000, false);
  await B.send('Page.bringToFront').catch(() => {});

  // ---------- 16. Đăng nhập admin ----------
  await B.goto('/login', 3000);
  await B.ev(`localStorage.clear(); sessionStorage.clear(); 1`);
  await B.send('Network.clearBrowserCookies');
  await B.goto('/login', 3000);
  await B.ev(`(function(){
    document.querySelector('#lg-email').value='namhbcf';
    document.querySelector('#lg-pwd').value='namhbcf123';
    document.querySelector('#login-submit').click();
    return 1;
  })()`);
  await B.wait(5500);

  const who = await B.ev(`fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.user?{u:d.user.username,role:d.user.role}:null).catch(()=>null)`);
  R.ok(16, 'Đăng nhập admin bằng namhbcf', who && who.u === 'namhbcf' && who.role === 'admin',
    who ? `${who.u}/${who.role}` : 'THẤT BẠI — không lấy được /api/auth/me');
  if (!who || who.role !== 'admin') {
    R.print(); writeFileSync('_qa_shots/report-C.json', JSON.stringify(R.rows, null, 2));
    await B.close(); return;
  }
  R.ok('16b', 'Đăng nhập admin chuyển tới /admin', /\/admin/.test(String(await B.hash())), String(await B.hash()));

  const tabResults = {};

  for (const [tab, label] of TABS) {
    await B.startCollect();
    await B.goto('/admin?tab=' + tab, 4500);
    const log = B.stopCollect();

    const info = await B.ev(`(function(){
      var host=document.getElementById('admin-content');
      var t=host?host.innerText:'';
      var html=host?host.innerHTML:'';
      return {
        len: t.length,
        text: t,
        loading: /Đang tải|loading/i.test(t) && t.length < 200,
        emptyState: !!host.querySelector('.empty-state'),
        mountErr: /Mount error|Đã có lỗi xảy ra/i.test(t),
        tables: host.querySelectorAll('table').length,
        rows: host.querySelectorAll('tbody tr').length,
        has1970: /1970/.test(t),
        activeNav: (document.querySelector('.admin-nav-item.active')||{}).innerText||'',
      };
    })()`);

    // Quét ngày 1970 chi tiết
    const d1970 = await B.ev(`(function(){
      var host=document.getElementById('admin-content');
      if(!host) return [];
      var out=[];
      var walk=document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      var n;
      while((n=walk.nextNode())){
        var s=(n.nodeValue||'').trim();
        if(/1970|Invalid Date|NaN/.test(s)) out.push(s.slice(0,60));
      }
      return out.slice(0,10);
    })()`);

    tabResults[tab] = { ...info, d1970, log };
    const errN = log.console.filter((c) => c.type !== 'warning').length;
    const httpN = log.http.filter((h) => h.status >= 400);

    await B.shot('C-' + tab, { clip: { x: 0, y: 0, width: 1440, height: 1250 } });

    const broken = info.loading || info.mountErr || (info.len < 30);
    R.ok('T:' + tab, `Tab "${label}" render OK`, !broken,
      broken ? `len=${info.len} loading=${info.loading} mountErr=${info.mountErr} text=${info.text.slice(0, 150)}`
             : `${info.len} ký tự, ${info.tables} bảng, ${info.rows} dòng`);
    R.ok('E:' + tab, `Tab "${label}" 0 console error`, errN === 0,
      log.console.slice(0, 3).map((c) => `[${c.type}]${c.text}`).join(' || '));
    if (httpN.length) {
      R.warn('H:' + tab, `Tab "${label}" HTTP error`, httpN.slice(0, 4).map((h) => `${h.status} ${h.url}`).join(' || '));
    }
    if (d1970.length) R.ok('D:' + tab, `Tab "${label}" KHÔNG lỗi ngày 1970`, false, JSON.stringify(d1970));
  }

  // ---------- 19. Tab Người dùng — không còn cột "Số dư" ----------
  await B.goto('/admin?tab=users', 4000);
  const usersProbe = await B.ev(`(function(){
    var host=document.getElementById('admin-content');
    var heads=Array.from(host.querySelectorAll('th')).map(t=>t.innerText.trim());
    var t=host.innerText;
    return {heads:heads,
      hasSoDu: heads.some(h=>/số dư/i.test(h)),
      hasNap: /nạp tiền/i.test(t),
      hasWallet: /ví/i.test(t),
      modalTitle: /Điều chỉnh số dư/i.test(host.innerHTML),
      total: (t.match(/Người dùng\\s*\\(?([0-9]+)/)||[])[1]||null};
  })()`);
  R.ok(19, 'Tab Người dùng KHÔNG còn cột "Số dư"', !usersProbe.hasSoDu,
    `cột: ${JSON.stringify(usersProbe.heads)}`);
  R.ok('19b', 'Tab Người dùng không còn chữ "nạp tiền"/"ví"', !usersProbe.hasNap && !usersProbe.hasWallet,
    `nạp=${usersProbe.hasNap} ví=${usersProbe.hasWallet}`);
  R.ok('19c', 'Không còn modal "Điều chỉnh số dư" trong DOM', !usersProbe.modalTitle);

  // ---------- 20. Tab License — lỗi 1970 ----------
  await B.goto('/admin?tab=licenses', 4500);
  const lic = await B.ev(`(function(){
    var host=document.getElementById('admin-content');
    var t=host.innerText;
    var dates=[];
    host.querySelectorAll('tbody tr').forEach(function(tr){
      var cells=Array.from(tr.querySelectorAll('td')).map(td=>td.innerText.trim());
      cells.forEach(function(c){ if(/\\d{1,2}:\\d{2}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{4}|1970|—/.test(c)) dates.push(c); });
    });
    return {txt:t.slice(0,900), has1970:/1970/.test(t), invalid:/Invalid Date|NaN/i.test(t),
      sample: dates.slice(0,14), rows: host.querySelectorAll('tbody tr').length,
      heads: Array.from(host.querySelectorAll('th')).map(x=>x.innerText.trim())};
  })()`);
  R.ok(20, 'Tab License KHÔNG có ngày 1970', !lic.has1970 && !lic.invalid,
    lic.has1970 || lic.invalid ? `1970=${lic.has1970} invalid=${lic.invalid} :: ${JSON.stringify(lic.sample)}` : `${lic.rows} dòng`);
  R.info('20b', 'Tab License — mẫu ngày hiển thị', JSON.stringify(lic.sample));
  R.info('20c', 'Tab License — cột', JSON.stringify(lic.heads));

  // ---------- 21. Tab Cài đặt ----------
  await B.goto('/admin?tab=settings', 4500);
  const st = await B.ev(`(function(){
    var host=document.getElementById('admin-content');
    var t=host.innerText;
    var inputs=Array.from(host.querySelectorAll('input,select,textarea')).map(function(i){
      return {id:i.id||i.name||'', type:i.type, val:(i.value||'').slice(0,40),
        dis:i.disabled};
    });
    return {txt:t.slice(0,1400), inputs:inputs,
      hasBank:/0010131639304/.test(host.innerHTML+host.innerText),
      hasMB:/MBBank/i.test(t), hasHours:/giờ|hour/i.test(t),
      hasWindow:/cửa sổ|window|08:00|22:00/i.test(t),
      btnCount: host.querySelectorAll('button').length};
  })()`);
  R.ok(21, 'Tab Cài đặt render OK', st.txt.length > 100, st.txt.slice(0, 200).replace(/\n/g, ' | '));
  R.info('21b', 'Cài đặt — trường nhập', JSON.stringify(st.inputs).slice(0, 900));
  R.info('21c', 'Cài đặt — ngân hàng/giờ', `bank=${st.hasBank} mb=${st.hasMB} hours=${st.hasHours} window=${st.hasWindow}`);
  R.info('21d', 'Cài đặt — text', st.txt.replace(/\n/g, ' | ').slice(0, 900));

  // ---------- 17. Tab Chờ thanh toán chi tiết ----------
  await B.goto('/admin?tab=topups', 4500);
  const tu = await B.ev(`(function(){
    var host=document.getElementById('admin-content');
    var t=host.innerText;
    return {txt:t.slice(0,1200),
      hasUnmatched:/chưa gán/i.test(t),
      hasMatchedCount:/đã khớp/i.test(t),
      buttons: Array.from(host.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,20),
      rows: host.querySelectorAll('tbody tr').length};
  })()`);
  R.info('17b', 'Chờ thanh toán — text', tu.txt.replace(/\n/g, ' | ').slice(0, 800));
  R.info('17c', 'Chờ thanh toán — nút', JSON.stringify(tu.buttons));
  R.ok('17d', 'Chờ thanh toán có ô "tiền chưa gán" (đối soát)', tu.hasUnmatched || tu.hasMatchedCount,
    `unmatched=${tu.hasUnmatched} matched=${tu.hasMatchedCount}`);

  const c = R.print();
  writeFileSync('_qa_shots/report-C.json', JSON.stringify({ rows: c.rows, counts: R.counts, tabs: tabResults, users: usersProbe, lic, settings: st, topups: tu }, null, 2));
  await B.close();
})();
