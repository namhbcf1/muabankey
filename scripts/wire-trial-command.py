# -*- coding: utf-8 -*-
"""Nối route /api/trial/command."""
import pathlib

f = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'index.js'
s = f.read_text(encoding='utf-8')

if 'trial-command' in s:
    print('· đã có')
else:
    # import
    anchor_imp = "import * as trialAdmin from './routes/trial-admin.js';"
    if anchor_imp in s:
        s = s.replace(anchor_imp,
                      anchor_imp + "\nimport * as trialCmd from './routes/trial-command.js';", 1)
        print('✓ import')

    # route
    anchor_rt = "r.post('/api/trial/claim', trial.apiTrialClaim);"
    if anchor_rt in s:
        s = s.replace(anchor_rt,
                      anchor_rt + "\nr.post('/api/trial/command', trialCmd.apiTrialCommand);", 1)
        print('✓ route')
    else:
        print('✗ không thấy anchor route')

    f.write_text(s, encoding='utf-8')
