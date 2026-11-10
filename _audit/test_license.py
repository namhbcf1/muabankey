"""Bo test scenario B (phan license) - chay voi mock server."""
import os, sys, json, time, subprocess, socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import run_case, show, RESULTS, ROOT, CLIENT, PY

AUD = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(AUD, 'reqlog.jsonl')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_mock(mode, port):
    if os.path.exists(LOG):
        os.remove(LOG)
    p = subprocess.Popen([PY, os.path.join(AUD, 'mock_server.py'), str(port), mode],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(80):
        try:
            s = socket.create_connection(('127.0.0.1', port), 0.15)
            s.close()
            return p
        except OSError:
            time.sleep(0.05)
    raise RuntimeError('mock khong len: ' + (p.stderr.read() or b'').decode())


def reqs():
    if not os.path.exists(LOG):
        return []
    return [json.loads(l) for l in open(LOG, encoding='utf-8') if l.strip()]


PORT = free_port()
BASE = 'http://127.0.0.1:%d' % PORT

print('mock port', PORT)


def with_mock(mode, fn):
    p = start_mock(mode, PORT)
    try:
        time.sleep(0.15)
        return fn()
    finally:
        p.terminate()
        p.wait(timeout=5)
        time.sleep(0.1)


# ============================================================
# B7: Khong co lic.bin, co mang -> tu bat trial hay hoi key?
# ============================================================
def t7():
    return run_case('B7 no-lic co mang -> auto trial', {'XA_API_BASE': BASE},
                    args=['--status'], delete_state=True)

r = with_mock('ok', t7); show(r)
print('  >>> requests:', [(x['path'], x.get('body')) for x in reqs()])

# ============================================================
# B8: Co lic.bin hop le -> chay binh thuong (dung --status)
# ============================================================
def seed_valid(statedir):
    """Tao lic.bin hop le bang chinh client: goi --key qua mock."""
    env = dict(os.environ)
    env.update({'XA_API_BASE': BASE, 'XA_STATE_SUBDIR': os.path.basename(statedir),
                'PYTHONIOENCODING': 'utf-8'})
    p = subprocess.run([PY, CLIENT, '--key', 'AOE1-TEST-TEST-TEST'],
                       capture_output=True, env=env, cwd=ROOT, timeout=40)
    return p


def t8():
    sub = 'XA_audit_B8'
    import shutil
    sd = os.path.join(os.environ['LOCALAPPDATA'], sub)
    if os.path.isdir(sd):
        shutil.rmtree(sd, ignore_errors=True)
    seed_valid(sd)
    exists = os.path.exists(os.path.join(sd, 'lic.bin'))
    print('  lic.bin ton tai sau --key:', exists)
    return run_case('B8 co lic.bin hop le -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir=sub)

r = with_mock('ok', t8); show(r)
print('  >>> requests:', [x['path'] for x in reqs()])

# ============================================================
# B9: key het han
# ============================================================
def t9():
    return run_case('B9 key het han -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('expired', t9); show(r)

# ============================================================
# B10: key bi revoke
# ============================================================
def t10():
    return run_case('B10 key revoked -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('revoked', t10); show(r)

# ============================================================
# B11: HWID sai (may khac)
# ============================================================
def t11():
    return run_case('B11 hwid mismatch -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('hwid', t11); show(r)

# ============================================================
# B12: Khong co mang
# ============================================================
def t12():
    dead = 'http://127.0.0.1:1'
    return run_case('B12 khong co mang -> --status', {'XA_API_BASE': dead},
                    args=['--status'], state_subdir='XA_audit_B8', timeout=60)

r = t12(); show(r)

# ============================================================
# B12b: DNS khong resolve
# ============================================================
def t12b():
    return run_case('B12b DNS fail -> --status',
                    {'XA_API_BASE': 'https://khong-ton-tai-abcxyz-12345.example'},
                    args=['--status'], state_subdir='XA_audit_B8', timeout=60)

r = t12b(); show(r)

# ============================================================
# B13: Server 500
# ============================================================
def t13():
    return run_case('B13 server 500 -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('http500', t13); show(r)

# ============================================================
# B13b: 502 HTML
# ============================================================
def t13b():
    return run_case('B13b server 502 HTML -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('html502', t13b); show(r)

# ============================================================
# B14: Server tra JSON loi (truncated) -> crash?
# ============================================================
def t14():
    return run_case('B14 JSON hong -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('badjson', t14); show(r)

# ============================================================
# B14b: Body rong
# ============================================================
def t14b():
    return run_case('B14b body rong -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('empty', t14b); show(r)

# ============================================================
# B14c: rate_limit 429
# ============================================================
def t14c():
    return run_case('B14c rate_limit -> --status', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8')

r = with_mock('ratelimit', t14c); show(r)

# ============================================================
# B14d: timeout (server treo)
# ============================================================
def t14d():
    return run_case('B14d server treo (timeout 10s)', {'XA_API_BASE': BASE},
                    args=['--status'], state_subdir='XA_audit_B8', timeout=90)

r = with_mock('slow', t14d); show(r)

json.dump(RESULTS, open(os.path.join(AUD, 'res_license.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\n\nDA LUU res_license.json  (%d case)' % len(RESULTS))
