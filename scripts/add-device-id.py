# -*- coding: utf-8 -*-
"""Thêm device_id (localStorage) vào request trial/command."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'pages' / 'home.js'
s = f.read_text(encoding='utf-8')

if 'device_id' in s:
    print('· đã có device_id')
    raise SystemExit(0)

# 1. Thêm hàm lấy device_id
anchor_fn = "async function startTrialFlow(kind, onDone) {"
helper = '''/**
 * ID thiết bị do browser sinh, lưu localStorage.
 * Dùng để tách quota giữa các máy cùng IP (quán net, NAT chung).
 * KHÔNG phải định danh bảo mật — chỉ để không chia chung lượt.
 */
function trialDeviceId() {
  try {
    let id = localStorage.getItem('xa_device_id');
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('xa_device_id', id);
    }
    return id;
  } catch {
    return null;
  }
}

async function startTrialFlow(kind, onDone) {'''
if anchor_fn in s:
    s = s.replace(anchor_fn, helper, 1)
    print('✓ thêm trialDeviceId()')

# 2. Gửi device_id trong request
old = """    const data = await api('/api/trial/command', {
      method: 'POST',
      body: { kind },
    });"""
new = """    const data = await api('/api/trial/command', {
      method: 'POST',
      body: { kind, device_id: trialDeviceId() },
    });"""
if old in s:
    s = s.replace(old, new, 1)
    print('✓ gửi device_id')
else:
    print('✗ không thấy khối api call')

f.write_text(s, encoding='utf-8')
