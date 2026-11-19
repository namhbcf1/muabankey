"""Test featureKeysFor + shapeEntitlement (khong can DB)."""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'routes', 'entitlement.js')

s = open(SRC, encoding='utf-8').read()
s = s.replace("import { json } from '../lib/http.js';", '')
idx = s.find('/**\n * GET /api/entitlement')
if idx > 0:
    s = s[:idx]

tmp = os.path.join(tempfile.gettempdir(), 'ent_pure.mjs')
open(tmp, 'w', encoding='utf-8').write(s)
url = 'file:///' + tmp.replace('\\', '/')

JS = open(os.path.join(ROOT, 'scripts', '_ent_cases.js'),
          encoding='utf-8').read().replace('__URL__', url)

run = os.path.join(tempfile.gettempdir(), 'ent_run.mjs')
open(run, 'w', encoding='utf-8').write(JS)

r = subprocess.run(['node', run], capture_output=True, text=True)
print(r.stdout)
if r.stderr.strip():
    print('--- stderr ---')
    print(r.stderr[:900])
sys.exit(r.returncode)
