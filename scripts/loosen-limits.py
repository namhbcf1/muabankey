# -*- coding: utf-8 -*-
"""Nới các rate limit ảnh hưởng khách thật (quán net, NAT chung)."""
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent

CHANGES = [
    # (file, cũ, mới, mô tả)
    ('src/routes/trial.js',
     "rateLimit(env, `trial:${ip}`, 20, 3600)",
     "rateLimit(env, `trial:${ip}`, 200, 3600)",
     'trial/IP: 20 -> 200/giờ'),

    ('src/routes/trial.js',
     "rateLimit(env, `trial:u:${user.id}`, 30, 3600)",
     "rateLimit(env, `trial:u:${user.id}`, 200, 3600)",
     'trial/user: 30 -> 200/giờ'),

    ('src/index.js',
     "rateLimit(env, `g:${clientIp(request)}`, 300, 60)",
     "rateLimit(env, `g:${clientIp(request)}`, 3000, 60)",
     'global: 300 -> 3000/phút'),

    ('src/routes/auth.js',
     "rateLimit(env, `reg:${ip}`, 100, 3600)",
     "rateLimit(env, `reg:${ip}`, 300, 3600)",
     'đăng ký: 100 -> 300/giờ'),

    ('src/routes/auth.js',
     "rateLimit(env, `login:${ip}`, 100, 900)",
     "rateLimit(env, `login:${ip}`, 500, 900)",
     'đăng nhập: 100 -> 500/15 phút'),

    ('src/routes/license.js',
     "rateLimit(env, `rebind:${user.id}:${clientIp(request)}`, 20, 3600)",
     "rateLimit(env, `rebind:${user.id}:${clientIp(request)}`, 100, 3600)",
     'đổi máy: 20 -> 100/giờ'),
]

for rel, old, new, desc in CHANGES:
    f = root / rel
    s = f.read_text(encoding='utf-8')
    if old in s:
        s = s.replace(old, new, 1)
        f.write_text(s, encoding='utf-8')
        print(f'✓ {desc}')
    else:
        print(f'· không thấy: {desc}')
