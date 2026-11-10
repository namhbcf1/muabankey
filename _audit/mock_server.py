"""Mock license server: gia lap MOI kieu phan hoi de test client that.

Chay: python _audit/mock_server.py <PORT> <MODE>
MODE: ok | expired | revoked | hwid | notfound | http500 | badjson | html502 |
      empty | slow | ratelimit | trial_ok | trial_expired | trial_denied |
      trial_limit | trial_disabled | badreq
Ghi log moi request ra _audit/reqlog.jsonl
"""
import json, os, sys, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) > 2 else 'ok'
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reqlog.jsonl')
NOW = int(time.time())

def log(rec):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec) + '\n')

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json'):
        raw = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace') if n else ''
        try:
            pj = json.loads(body) if body else {}
        except Exception:
            pj = {'_unparsable': body[:200]}
        log({'at': time.time(), 'path': self.path, 'body': pj,
             'ua': self.headers.get('user-agent'),
             'ctype': self.headers.get('content-type')})

        path = self.path.split('?')[0]

        if MODE == 'slow':
            time.sleep(20)
        if MODE == 'http500':
            self._send(500, '<html>Internal Server Error</html>', 'text/html')
            return
        if MODE == 'html502':
            self._send(502, '<html><body>502 Bad Gateway</body></html>', 'text/html')
            return
        if MODE == 'badjson':
            self._send(200, '{"ok": true, "expires_at": 9999999', 'application/json')
            return
        if MODE == 'empty':
            self._send(200, '', 'application/json')
            return

        if path == '/api/activate':
            if MODE == 'expired':
                self._send(403, json.dumps({'ok': False, 'code': 'expired',
                                            'msg': 'Mã đã hết hạn', 'now': NOW,
                                            'expires_at': NOW - 86400}))
                return
            if MODE == 'revoked':
                self._send(403, json.dumps({'ok': False, 'code': 'revoked',
                                            'msg': 'Mã đã bị thu hồi', 'now': NOW}))
                return
            if MODE == 'hwid':
                self._send(403, json.dumps({'ok': False, 'code': 'hwid_mismatch',
                                            'msg': 'Mã đã dùng trên máy khác', 'now': NOW}))
                return
            if MODE == 'notfound':
                self._send(403, json.dumps({'ok': False, 'code': 'not_found',
                                            'msg': 'Mã không tồn tại', 'now': NOW}))
                return
            if MODE == 'ratelimit':
                self._send(429, json.dumps({'ok': False, 'code': 'rate_limit',
                                            'msg': 'Quá nhiều lần thử', 'now': NOW}))
                return
            if MODE == 'badreq':
                self._send(400, json.dumps({'ok': False, 'code': 'bad_request',
                                            'msg': 'JSON không hợp lệ'}))
                return
            self._send(200, json.dumps({
                'ok': True, 'now': NOW, 'expires_at': NOW + 30 * 86400,
                'activated_at': NOW, 'plan': 'aoe1', 'forever': False,
                'grace_hours': 0, 'trial': False, 'first_bind': True}))
            return

        if path == '/api/check':
            if MODE == 'expired':
                self._send(403, json.dumps({'ok': False, 'code': 'expired',
                                            'msg': 'Mã đã hết hạn', 'now': NOW,
                                            'expires_at': NOW - 86400}))
                return
            if MODE == 'revoked':
                self._send(403, json.dumps({'ok': False, 'code': 'revoked',
                                            'msg': 'Mã đã bị thu hồi', 'now': NOW}))
                return
            if MODE == 'hwid':
                self._send(403, json.dumps({'ok': False, 'code': 'hwid_mismatch',
                                            'msg': 'Mã đã dùng trên máy khác', 'now': NOW}))
                return
            if MODE == 'notfound':
                self._send(403, json.dumps({'ok': False, 'code': 'not_found',
                                            'msg': 'Mã không tồn tại', 'now': NOW}))
                return
            if MODE == 'ratelimit':
                self._send(429, json.dumps({'ok': False, 'code': 'rate_limit',
                                            'msg': 'Quá nhiều lần thử', 'now': NOW}))
                return
            if MODE == 'badreq':
                self._send(400, json.dumps({'ok': False, 'code': 'bad_request'}))
                return
            # ok / trial_* -> con han
            self._send(200, json.dumps({
                'ok': True, 'now': NOW, 'expires_at': NOW + 30 * 86400,
                'activated_at': NOW - 3600, 'plan': 'aoe1', 'forever': False,
                'grace_hours': 0, 'trial': False}))
            return

        if path == '/api/trial/start':
            if MODE == 'trial_expired':
                self._send(403, json.dumps({'ok': False, 'code': 'trial_expired',
                                            'msg': 'Máy này đã dùng hết 3 ngày'}))
                return
            if MODE == 'trial_denied':
                self._send(403, json.dumps({'ok': False, 'code': 'trial_denied_device',
                                            'msg': 'Không hỗ trợ máy ảo'}))
                return
            if MODE == 'trial_limit':
                self._send(429, json.dumps({'ok': False, 'code': 'trial_limit',
                                            'msg': 'Hết lượt dùng thử'}))
                return
            if MODE == 'trial_disabled':
                self._send(403, json.dumps({'ok': False, 'code': 'trial_disabled',
                                            'msg': 'Dùng thử đang tạm đóng'}))
                return
            self._send(200, json.dumps({
                'ok': True, 'key': 'TR-ABCDEF1234567890', 'plan': 'trial',
                'trial': True, 'trial_kind': 'new', 'now': NOW,
                'expires_at': NOW + 3 * 86400, 'activated_at': NOW,
                'days_left': 3, 'grace_hours': 0}))
            return

        self._send(404, json.dumps({'ok': False, 'code': 'not_found'}))

    def do_GET(self):
        log({'at': time.time(), 'path': self.path, 'method': 'GET'})
        self._send(200, json.dumps({'ok': True, 'now': NOW}))

if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    srv.daemon_threads = True
    sys.stderr.write('mock up on %d mode=%s\n' % (PORT, MODE))
    srv.serve_forever()
