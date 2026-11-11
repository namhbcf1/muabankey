# -*- coding: utf-8 -*-
"""Nối route whitelist admin."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'index.js'
s = f.read_text(encoding='utf-8')

if 'trial-whitelist-admin' in s:
    print('· đã có')
    raise SystemExit(0)

# import
anchor = "import * as trialCmd from './routes/trial-command.js';"
if anchor in s:
    s = s.replace(anchor,
                  anchor + "\nimport * as twl from './routes/trial-whitelist-admin.js';", 1)
    print('✓ import')

# routes — chèn sau route trial/ban
anchor2 = "r.post('/api/admin/trial/ban', trialAdmin.adminTrialBan);"
routes = (
    "\nr.get('/api/admin/trial/whitelist', twl.adminWhitelistList);"
    "\nr.post('/api/admin/trial/whitelist', twl.adminWhitelistAdd);"
    "\nr.delete('/api/admin/trial/whitelist', twl.adminWhitelistRemove);"
    "\nr.post('/api/admin/trial/whitelist/this-device', twl.adminWhitelistThisDevice);"
)
if anchor2 in s:
    s = s.replace(anchor2, anchor2 + routes, 1)
    print('✓ routes')
else:
    print('✗ không thấy anchor trial/ban')

f.write_text(s, encoding='utf-8')
