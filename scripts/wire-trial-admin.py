# -*- coding: utf-8 -*-
"""Nối route trial-admin vào index.js."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'index.js'
s = f.read_text(encoding='utf-8')
done = []

# 1. Import
if 'trial-admin' not in s:
    old = "import * as trial from './routes/trial.js';"
    new = old + "\nimport * as trialAdmin from './routes/trial-admin.js';"
    if old in s:
        s = s.replace(old, new, 1)
        done.append('import')
    else:
        print('KHONG THAY import trial')
else:
    done.append('import (da co)')

# 2. Routes
if '/api/admin/trial/accounts' not in s:
    anchor = "r.get('/api/admin/telegram/status'"
    routes = (
        "r.get('/api/admin/trial/accounts', trialAdmin.adminTrialAccounts);\n"
        "r.get('/api/admin/trial/uses', trialAdmin.adminTrialUses);\n"
        "r.get('/api/admin/trial/resets', trialAdmin.adminTrialResets);\n"
        "r.post('/api/admin/trial/reset', trialAdmin.adminTrialReset);\n"
        "r.post('/api/admin/trial/grant', trialAdmin.adminTrialGrant);\n"
        "r.post('/api/admin/trial/ban', trialAdmin.adminTrialBan);\n"
    )
    if anchor in s:
        s = s.replace(anchor, routes + anchor, 1)
        done.append('routes')
    else:
        print('KHONG THAY anchor telegram/status')
else:
    done.append('routes (da co)')

# 3. Thêm route /api/trial/stop
if '/api/trial/stop' not in s:
    old = "r.get('/api/trial/status', trial.apiTrialStatus);"
    new = old + "\nr.post('/api/trial/stop', trial.apiTrialStop);"
    if old in s:
        s = s.replace(old, new, 1)
        done.append('trial/stop')
    else:
        print('KHONG THAY /api/trial/status')

f.write_text(s, encoding='utf-8')
print('OK:', ', '.join(done))
