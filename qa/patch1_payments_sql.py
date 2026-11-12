# -*- coding: utf-8 -*-
"""QA patch 1: fix payment-ledger SQL arity (money silently dropped)."""
import io

P = 'src/routes/payments.js'
s = io.open(P, encoding='utf-8', newline='').read()
orig = s
changes = []


def rep(old, new, label):
    global s
    if old not in s:
        print('!! NOT FOUND: ' + label)
        return False
    s = s.replace(old, new, 1)
    changes.append(label)
    return True


# ---------------------------------------------------------------- FIX 1
# Unmatched inbound money (no order matched): column list had 12 names while
# bind() supplied 13 values -- the 13th is `isTest`. SQLite rejects
# "13 values for 12 columns"; the INSERT sits inside `catch {}` so the money
# was dropped without a single log line. Verified live: webhook replied
# {"reason":"NO_ORDER_MATCH"} and payments gained no row.
old1 = (
    "           (id, order_id, order_code, amount, expected, method, txn_ref,\r\n"
    "\r\n"
    "            content, state, confirmed_by, raw, at)\r\n"
    "\r\n"
    "         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`"
)
new1 = (
    "           (id, order_id, order_code, amount, expected, method, txn_ref,\r\n"
    "\r\n"
    "            content, state, confirmed_by, raw, at, is_test)\r\n"
    "\r\n"
    "         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`"
)
rep(old1, new1, 'FIX1 unmatched-payment INSERT: 12 cols -> 13 cols')

# ---------------------------------------------------------------- FIX 2
# Out-of-window branch (12:00-23:59): column list had 12 names but the VALUES
# list produced 13 slots (8 placeholders + 'matched' + 'sepay-window' +
# 3 placeholders). EVERY afternoon inbound payment failed and was swallowed by
# `catch`, so the shop's Telegram approval path never saw the money either.
# Also: `state` is now computed from the real amount instead of being hardcoded
# 'matched', so a short transfer is labelled 'wrong_amount' exactly like the
# in-window path does.
old2 = (
    "        `INSERT INTO payments\r\n"
    "           (id, order_id, order_code, amount, expected, method, txn_ref,\r\n"
    "            content, state, confirmed_by, raw, at)\r\n"
    "         VALUES (?,?,?,?,?,?,?,?,'matched','sepay-window',?,?,?)`\r\n"
    "      ).bind(crypto.randomUUID(), order.id, order.code, amount,\r\n"
    "        Number(order.total) || 0, 'sepay', txnRef || null, content || null,\r\n"
    "        JSON.stringify(body).slice(0, 3000), nowSec(), isTest ? 1 : 0).run();"
)
new2 = (
    "        `INSERT INTO payments\r\n"
    "           (id, order_id, order_code, amount, expected, method, txn_ref,\r\n"
    "            content, state, confirmed_by, raw, at, is_test)\r\n"
    "         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`\r\n"
    "      ).bind(crypto.randomUUID(), order.id, order.code, amount,\r\n"
    "        expected, 'sepay', txnRef || null, content || null,\r\n"
    "        state, 'sepay-window',\r\n"
    "        JSON.stringify(body).slice(0, 3000), nowSec(), isTest ? 1 : 0).run();"
)
rep(old2, new2, 'FIX2 out-of-window INSERT: 12 cols -> 13 cols, real state')

if s is not orig:
    io.open(P, 'w', encoding='utf-8', newline='').write(s)
    print('PATCHED ' + P)
    for c in changes:
        print('  - ' + c)
else:
    print('NO CHANGE')
