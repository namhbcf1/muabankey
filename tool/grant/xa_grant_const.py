# -*- coding: utf-8 -*-
"""Bang hang so da ma hoa cho XA THÊM TÀI NGUYÊN. SINH TU DONG boi gen_grant_const.py.

KHONG SUA TAY. Chay lai:  python tool/grant/gen_grant_const.py

Vi sao phai ma hoa hang so:
    Khoa CONG KHAI (public key) khong phai bi mat — nhung neu de dang hex
    trong binary thi nguoi go EXE se thay ngay va thay no bang khoa cua minh
    de tu ky token. Ma hoa nhe (XOR voi khoa sinh tu salt) lam viec "tim va
    thay" kho kho hon nhieu ma khong ton chi phi.

    Day KHONG phai bao ve tuyet doi. Nguoi doc duoc source van lam duoc.
    Muc tieu la chan kich ban pho bien: go EXE bang pyinstxtractor roi sua
    vai dong. Phan bao ve that nam o chu ky ECDSA + gate rieng tung license.
"""

BLOBS = {
    1: '4a29e1bdf67c303e5c805b1cd8ff85270dd69cab4fb3d3a2d2c3852bd82cc5ac',
    2: '3965e5a2c58990aa890c40864fbf835145d2d042aa7d6cb5ddb176b88d4dd136',
}

# Chi so hang so, dung chung giua gen_grant_const.py va xa_grant_sec.py
K_PUB_X = 1
K_PUB_Y = 2

_SALT_A = b'XG|7a2e'
_SALT_B = b'4c81|mK'

import hashlib as _hl


def _xk(i):
    """Sinh khoa XOR cho hang so thu i. Khong co bang khoa nao luu trong file."""
    return _hl.sha256(_SALT_A + bytes([i & 0xFF]) + _SALT_B).digest()[:16]


def _dec(i):
    """Giai ma hang so thu i thanh bytes. b'' neu hong."""
    blob = BLOBS.get(i, '')
    if not blob:
        return b''
    try:
        raw = bytes.fromhex(blob)
    except (ValueError, TypeError):
        return b''
    k = _xk(i)
    out = bytearray(len(raw))
    for n, b in enumerate(raw):
        out[n] = b ^ k[n % 16]
    return bytes(out)


def blob_hex(i):
    """Gia tri da giai ma, dang hex."""
    return _dec(i).hex()


def public_xy():
    """Tra (x, y) la hai so nguyen cua khoa cong khai ECDSA P-256."""
    hx = blob_hex(K_PUB_X)
    hy = blob_hex(K_PUB_Y)
    if not hx or not hy:
        raise ValueError('thieu hang so khoa cong khai')
    return (int(hx, 16), int(hy, 16))
