"""Chay client trong MOI tinh huong, ghi ket qua that.

Dung XA_API_BASE (bien moi truong) -> client doc qua _c('API_BASE').
Dung XA_STATE_SUBDIR de tach state tung test.
"""
import json, os, shutil, subprocess, sys, time, tempfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT = os.path.join(ROOT, 'tool', 'src', 'xa_nofog_pro.py')
PY = sys.executable
RESULTS = []


def run_case(name, env_extra=None, args=(), timeout=45, expect=None,
             mutate_state=None, delete_state=False, state_subdir=None):
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'
    if env_extra:
        env.update(env_extra)
    sub = state_subdir or ('XA_audit_' + name.replace(' ', '_').replace('/', '_'))
    env['XA_STATE_SUBDIR'] = sub
    statedir = os.path.join(env.get('LOCALAPPDATA', ''), sub)
    if delete_state and os.path.isdir(statedir):
        shutil.rmtree(statedir, ignore_errors=True)
    if mutate_state:
        mutate_state(statedir)
    t0 = time.time()
    try:
        p = subprocess.run([PY, CLIENT] + list(args), capture_output=True,
                           timeout=timeout, env=env, cwd=ROOT)
        out = (p.stdout or b'').decode('utf-8', 'replace')
        err = (p.stderr or b'').decode('utf-8', 'replace')
        rc = p.returncode
        to = False
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'').decode('utf-8', 'replace')
        err = (e.stderr or b'').decode('utf-8', 'replace')
        rc = 'TIMEOUT'
        to = True
    dt = time.time() - t0
    ok = None
    if expect is not None and not to:
        ok = (rc == expect)
    RESULTS.append({
        'case': name, 'args': list(args), 'rc': rc, 'secs': round(dt, 2),
        'ok': ok, 'stdout': out, 'stderr': err, 'statedir': statedir,
        'env': {k: v for k, v in (env_extra or {}).items()},
    })
    return RESULTS[-1]


def show(r, maxlen=1400):
    print('\n' + '=' * 78)
    print('CASE: %s  args=%s' % (r['case'], r['args']))
    print('  rc=%s  %.2fs  expect_ok=%s' % (r['rc'], r['secs'], r['ok']))
    print('  --- stdout ---')
    print('\n'.join('  | ' + l for l in r['stdout'].rstrip().splitlines()[:40]) or '  (rong)')
    if r['stderr'].strip():
        print('  --- stderr ---')
        print('\n'.join('  | ' + l for l in r['stderr'].rstrip().splitlines()[:25]))
