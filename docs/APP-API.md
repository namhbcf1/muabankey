# APP-API — Client ↔ Server contract, local state, entry point, and defect audit

Scope: `tool/app/xa_arena_api.py` and `tool/app/xa_arena_app.py`
Repo: `C:\Users\ADMIN\Desktop\muabankey`

| | |
|---|---|
| `xa_arena_api.py` | 2734 lines, 77 top-level functions, SHA-256 `508D51C21E697ED683D2416EA0CCED9412870DDB7807BA485C27D290449F7707` |
| `xa_arena_app.py` | 852 lines, 19 top-level functions, SHA-256 `96AF96C6E8E5F223BFFDD9C8950E3B33F80C103AD96E0C9346BC3BADA7463C57` |

> **Line numbers in this document refer to the hashes above.**
> `xa_arena_api.py` was **modified by another agent at 05:17:18 while this audit was
> running** (2663 → 2734 lines). The shop-whitelist gate was replaced during the
> audit (plaintext `shop.hwid` + `XA_SHOP_HWIDS` → ECDSA-signed `shop.lic`). Every
> finding below was re-verified against the post-change bytes. Functions at or
> above line 2077 shifted; everything below line 2061 is unchanged.

Nothing in this document was implemented as a change. Both `.py` files were read
only. No deployment, no rebuild.

---

## 1. Server contract

Base URL: `api_base()` (`xa_arena_api.py:336-345`) → `xa_nofog_pro.API_BASE` if
importable, else the literal `https://xienhl.com`.

Transport is `urllib.request` only. Two helpers:

* `_get_json(path, cookie=None, timeout=TIMEOUT)` — `xa_arena_api.py:746-769`.
  Returns a dict. On `HTTPError` it tries to parse the error body and
  **returns it as if it were a normal reply** with `ok` defaulted to `False`;
  if the body is not JSON it returns `{'ok': False, 'code': 'http_<status>'}`.
  Any other exception returns `{'ok': False, 'code': 'network', 'msg': ...}`.
* `_post_json(path, payload, timeout=20)` — `xa_arena_api.py:2590-2610`.
  Returns `(status, dict)`. Status `0` means "no answer" (transport failure) and
  must never be read as a verdict.

Cookie: `SESSION_COOKIE_NAME = 'mbk_session'` (`:23`), built by `_cookie_header()`
(`:731-743`). It must match the server exactly (`src/lib/auth.js`). A bare token
without `=` is wrapped as `mbk_session=<token>`; a string that already contains
`=` in its first segment is passed through unchanged.

### 1.1 Endpoints called directly from `xa_arena_api.py`

#### `GET /api/entitlement`

The single most important call — it decides every feature flag.

| | |
|---|---|
| Call sites | `:911` (by key), `:915` (by session only), `:972` (extra local-key merge) |
| Query | `key` (full licence key, URL-encoded), `hwid` (map-sáng HWID), `hwid2` (tài-nguyên HWID, sent only when different from `hwid`) |
| Header | `Cookie: mbk_session=<session>` when a session exists; `User-Agent: ya-arena` |
| Method | `GET` |

Request fields actually sent — `:858-865`:

```
hw1 = _hwid_for('nofog')      # sha256('v1|guid|bios|cpu|vol')[:32]
hw2 = _hwid_for('grant')      # xa_grant._guard_safe_hwid()
? key=<KEY>&hwid=<hw1>&hwid2=<hw2>
```

Both HWIDs are sent because the two modules derive **different** values on the
same machine (`:855-857`); sending one makes half the licences look like
`hwid_mismatch`.

Response fields read:

| Field | Read at | Meaning |
|---|---|---|
| `ok` | `:917` | master switch; `False` → error path |
| `code` | `:925` | error code (see §2) |
| `via` | `:966`, `:1299` | `'session'` or `'key'` |
| `user` | `_normalise` `:1346` | account name, or `None` |
| `features[]` | `:1338-1342` | only `'nofog'` and `'grant'` survive; anything else is dropped |
| `licenses[]` | `:1373-1388` | per-licence rows |
| `licenses[].key` | `_pick_key` `:1429` | the licence key |
| `licenses[].features[]` | `_pick_key` `:1416` | `nofog` / `grant` |
| `licenses[].active` | `_pick_key` `:1418` | skipped when falsy |
| `licenses[].revoked` | `:1318`, `:1644`, `:1002` | revoked → dropped, and local token deleted |
| `licenses[].forever` | `:1324` | never expires |
| `licenses[].expires_at` / `expiresAt` | `:1327`, `:1385-1386` | unix seconds; camelCase aliased at `:1385` |
| `licenses[].hwid_match` / `hwidMatch` | `:1377-1378`, `:1387-1388` | three-valued: `True` / `False` / `None` |
| `licenses[].plan` | `:1380` | `trial` = device-bound, `paid` = account-bound |
| `licenses[].isTrial` | `:1381-1382` | fallback when `plan` is absent |
| `isActiveDevice` / `is_active_device` | `:1366-1368` | `False` ⇒ this machine was kicked |
| `activeDeviceLabel` / `active_device_label` | `:1369-1371` | human label, truncated to 40 chars |
| `trial.{nofog,grant}.{left,total,used,leftSec,expiresAt}` | `quota_from_entitlement` `:2424-2479` | optional trial quota block |

Client behaviour on success (`:945-1016`):
1. `_normalise(d)` — validates/coerces, and **wipes `features` to `[]` if
   `session_moved(d)`** (`:1357-1359`). This is the anti-kick guard.
2. `set_last_code('')` and `_save_last_check(...)` (records the offline-grace epoch).
3. If `via == 'session'` **and not** `session_moved(d)`: fetches the local token's
   licence with a second `/api/entitlement?key=<local>` and merges licences +
   features by key (`:966-1013`). If that local licence is `revoked`, the local
   `xn_token` and `sites` are deleted from `lic.bin` (`:1001-1011`).
4. `save_entitlement(d)` (`:1015`) — persists the DPAPI cache.

Client behaviour on `ok: false` (`:917-943`):
1. `code = d['code']`; if the request was made **by session**,
   `code = account_code_of(code)` (`:926-927`) so `not_found` becomes
   `no_licence` ("account has no plan", not "you typed the key wrong").
2. `set_last_code(code or 'network')`.
3. **If `code == 'session_moved'` → return immediately, cache is NOT consulted**
   (`:934-935`). See defect **H1** for the exact-scope limits of this guard.
4. Otherwise `load_entitlement()`; if the cache has `ok: True`, return it with
   `_cached: True` (`:937-942`).

#### `POST /api/check`

| | |
|---|---|
| Call site | `:1697` inside `server_recheck()` |
| Body | `{"key": <key>, "hwid": <nofog HWID>}` |
| Purpose | re-verify a *map sáng* licence against the server (`revoked` detection) |

Handling (`:1700-1713`): `status == 200 and body.ok` ⇒ valid, stop, record
`_save_last_check`. `status == 0`, `>= 500`, or `code in ('rate_limit','network')`
⇒ counted as *not conclusive*. Any other code falls through to the next candidate
key. Only after **every** key fails does `:1733-1735` return `False` for
`revoked / expired / hwid_mismatch / not_found / trial_exhausted / account_locked`.
An unknown code is treated as "do not cut" (`:1738`).

Offline grace (`GRACE_SEC = 3 * 86400`, `:1457`): if every failure was
non-conclusive, the client allows use while `now - last_ok < 3 days`, else returns
`offline_grace_expired` (`:1725-1731`). `_fallback_check_time()` (`:1488-1512`)
substitutes the mtime of `entitlement.json` / `last_check.json` / `lic.bin` for
machines installed before `last_check.json` existed.

#### `POST /api/xg/activate`

| | |
|---|---|
| Call sites | `:2599` (`ensure_grant_token`), `:1605` (`_grant_recheck` bootstrap) |
| Body | `{"key": <key>, "hwid": <grant HWID>}` |
| Response used | `ok`, `sid`, `code`, `msg` |

Binds the tài-nguyên licence to this machine and returns a session id.
`already_bound` and `session_invalid` are **tolerated** and execution continues to
`/api/xg/check` (`:2604-2606`). Everything else aborts with
`"kích hoạt thất bại: <msg|code|HTTP n>"`.

#### `POST /api/xg/check`

| | |
|---|---|
| Call sites | `:2612` (`ensure_grant_token`), `:1617` (`_grant_recheck`) |
| Body | `{"key", "hwid", "sid"}` — `sid` omitted when empty |
| Response used | `token`, `ok`, `code`, `msg` |

Issues the signed tài-nguyên token. The token **must** start with `xg1.`
(`:2635-2636`) or it is rejected. If this call yields no token, the client falls
back to `xa_grant_sec.refresh_token(api_base(), key, hwid, sid)` (`:2619-2628`)
before giving up. The token is written with `XG.write_token(tok)` (`:2640`) and
the module is asked to re-validate with `XG.ensure_engine(None)` (`:2645`).

`_grant_recheck()` (`:1582-1621`) reuses the same two endpoints for periodic
re-verification. It returns `(0, {})` to mean "could not check" — the caller must
not treat that as a verdict. It reads `sid` from `xa_grant` state; if absent it
bootstraps via `/api/xg/activate`.

#### `POST /api/trial/claim`

| | |
|---|---|
| Call site | `:1802` via `NF._post('/api/trial/claim', ...)`, inside `claim_trial_key()` |
| Body | `{"key", "guid", "bios", "cpu", "vol", "app": NF.APP_NAME, "ver": NF.CLIENT_VERSION}` |
| Raw hardware parts come from | `NF._hwid_parts_checked()` (raises when hardware is unreadable) |
| Response used | `ok`, `code`, `msg`, `activated`, `hwid`, `trial_kind`, `expires_at`, `activated_at`, `recheck_sec`, `now` |

Why a separate path: a `TR-` trial key **cannot** be activated through
`/api/activate` — the server deliberately answers `403 trial_only` so one code
cannot be shared across 100 machines (`:1772-1774`). The correct sequence is
claim (bind + start the clock) → check (issue token).

Error codes mapped locally at `:1815-1823`:

| code | message returned to the caller |
|---|---|
| `not_found` | `Mã dùng thử không tồn tại` |
| `hwid_mismatch` | `Mã này đã gắn với máy khác` |
| `trial_expired` | `Lượt dùng thử đã hết hạn` |
| `revoked` | `Mã dùng thử đã bị thu hồi` |
| `not_trial` | `Đây là key trả phí, không phải mã dùng thử` |
| `bad_request` | `Mã không đúng dạng TR-XXXX-XXXX-XXXX` |
| `trial_denied_device` | `Không hỗ trợ dùng thử trên máy ảo` |
| *anything else* | server `msg`, else the raw code, else `lỗi không rõ` |

On success the client writes `lic.bin` state itself (`:1828-1859`): key, hwid,
`plan='trial'`, `trial_kind`, `trial_label`, `trial_started`, `grace_hours=0`,
`last_ok`, `mono_last_ok`, `mode='server'`, `recheck_sec`. If `activated` is true
it sets `expires_at`/`activated_at` and clears `hold_until`; otherwise it parks the
expiry in `hold_until` and zeroes `expires_at`. Then `NF.check_online()` fetches the
real token and `NF._load_sites()` loads the gate table.

#### `GET /api/trial/left`

| | |
|---|---|
| Call site | `:2252` in `trial_left()` |
| Query | `hwid` (from `trial_hwid()`), `kind` (default `1h`), `product` (`nofog` \| `xagrant`) |
| Response used | `ok`, `code`, `left`, `quota`, `used` |
| Timeout | 6 s (deliberately short — this is polled) |

Read-only by contract: the client is allowed to poll it because the endpoint never
consumes a trial turn (`:2204-2209`). HWID for counting comes from
`trial_hwid()` (`:2288-2307`), which prefers `state['hwid']` — the exact value the
server derived when it issued the quota — and only falls back to reading hardware
when state is empty, to avoid PowerShell/WMI work on a 20-second timer.

#### `POST /api/trial/command`

| | |
|---|---|
| Reached via | `NF.start_trial(kind=..., product=...)` at `:1987` → `xa_nofog_pro.py:1596` |
| Body | hardware parts (`guid`, `bios`, `cpu`, `vol`) — **no key, no login** |
| Called from | `ensure_free_trial()` `:1882-2061` |

This is the keyless free-trial path. `ensure_free_trial` tries trial kinds in the
order `('1h', '3d')` (`:1985`), continuing only when the reply is
`trial_kind_invalid` — because production has `trial3d_enabled=0` and
`trial1h_enabled=1`, so asking for `3d` first would mean the customer never gets a
trial (`:1975-1981`). Older `start_trial` signatures without `kind=` are detected
via `TypeError` (`:1989-1994`).

Failure classification (`:2032-2060`):

| server code | client state | message |
|---|---|---|
| `trial_quota_exhausted`, `trial_device_limit`, `trial_1h_limit`, `trial_device_acc_1h` | `exhausted`, `left=0` | `Máy này đã dùng hết lượt dùng thử. Mua key để tiếp tục.` |
| `hwid_unavailable`, or msg contains `không đọc được thông tin phần cứng` | `no_hw` | `Không đọc được thông tin máy. Thử chạy lại app.` |
| `trial_ip_limit`, `trial_net_limit`, `trial_global_limit`, `rate_limit` | `offline` | `Mạng này đã dùng hết lượt dùng thử hôm nay. Thử lại vào ngày mai, hoặc mua key để dùng ngay.` |
| `network`, `timeout`, `''` | `offline` | `Không kết nối được máy chủ. Kiểm tra mạng rồi bấm "Kiểm tra lại".` |
| anything else | `error` | `next_step_for(code)` else `Chưa bật được dùng thử. Bấm "Kiểm tra lại".` |

Guard against wasting turns: step 1 is `token_ok()`; if a working token already
exists the function returns `ok` without touching the server (`:1946-1961`).

#### `POST /api/activate`

| | |
|---|---|
| Reached via | `NF.activate(key, verbose=False)` at `:2496` → `xa_nofog_pro.py:1127` |
| Precondition | `is_trial_key(key)` is **false** — `TR-` keys divert to `claim_trial_key` at `:2486-2487` |
| Response used | `(ok, msg)` from `NF.activate` |

On failure `set_last_code(error_code_of(msg))` (`:2503`) so the UI can pick the
right next step. On success `set_last_code('')` then `NF._load_sites()` must also
succeed, else `"token mới vẫn không dùng được"` (`:2511`).

#### Login / logout

* `POST /api/auth/login` — `NF.login_to_server(username, password, verbose=False)`
  at `:1117` → `xa_nofog_pro.py:836`. That helper then calls
  `GET /api/auth/me` (`xa_nofog_pro.py:863`) and persists the cookie via
  `NF.save_session(cookie, username)`.
* `login()` (`:1110-1145`) re-checks `session_cookie()` afterwards and re-saves if
  it vanished (`:1126-1132`), then `clear_manual_key()` (`:1137`) so entitlement is
  computed from the **account**, not from one hand-pasted key, then
  `fetch_entitlement()`.
* **Logout is local only.** `logout()` (`:1148-1166`) calls `NF.drop_session()`
  and deletes `entitlement.json` + `entitlement_key.txt`. **There is no
  `/api/auth/logout` HTTP call** — the cookie stays valid server-side until it
  expires. A copied cookie can be replayed.

### 1.2 `GET /api/app/version` (update gate)

| | |
|---|---|
| Reached via | `xa_update.py:426` (uses `/api/setup/version` for the setup kind) |
| Callers in `xa_arena_app.py` | `update_enforce()` `:334`, `apply_pending_if_any()` `:399`, `diag_update()` `:681` |
| Query | kind `'arena'` (this app has its own release channel) |
| Response used | `ok`, `version`, `sha256`, `size`, `urlAbsolute` |

The update subsystem lives in `tool/ui/xa_update.py`; constants that matter for the
anti-loop logic:

```
MAX_APPLY_TRIES   = 2          RETRY_COOLDOWN_SEC = 21600
MAX_BAD_BOOTS     = 2          GOOD_BOOT_SEC      = 60
DL_TIMEOUT        = 300        BAT_MOVE_RETRIES   = 30
ALLOWED_HOSTS     = ('xienhl.com', 'www.xienhl.com')
```

### 1.3 Endpoints present in the ecosystem but NOT called from these two files

Documented for completeness so nobody assumes coverage. Verified by grepping the
whole `tool/` tree; none of these is reachable from `xa_arena_api.py` or
`xa_arena_app.py`.

| Endpoint | Defined in | Note |
|---|---|---|
| `POST /api/xg/heartbeat` | `tool/grant/src/xa_grant_lic.py:671` | only in the `src` copy of the grant licence module |
| `POST /api/xg/rebind` | `tool/grant/src/xa_grant_lic.py:692` | ditto |
| `POST /api/xg/violation` | `tool/grant/xa_grant_sec.py:499`, `src/…:508` | anti-tamper report |
| `POST /api/rebind` | `xa_nofog_pro.py:1061` | CLI-only "change machine" |
| `GET /api/trial/status`, `POST /api/trial/start` | referenced in `xa_nofog_pro.py:779`, `:743`, `:1561` | legacy / alternative trial paths |
| `GET /api/install-info`, `/api/install-info/resolve` | `tool/setup/xa_setup.py:932,939` | installer only |

`xa_arena_api.py` reaches `heartbeat`/`rebind`/`violation` **only** if
`xa_grant.ensure_engine()` internally drives `xa_grant_lic`. I did not trace that
call graph end-to-end — see §8.

---

## 2. Error-code tables

Two tables, both **lower-cased once at import** (`:177-178`) so that a code
returned in either case always matches:

```python
NEXT_STEP  = {k.lower(): v for k, v in NEXT_STEP.items()}   # line 177
STATE_TEXT = {k.lower(): v for k, v in STATE_TEXT.items()}  # line 178
```

This single normalisation fixed a whole class of bugs: `error_code_of()` always
returns lower case, while the source tables contained `TRIAL_NOT_FOUND`,
`WRONG_PRODUCT`, `REVOKED`, `EXPIRED`, so every upper-case code missed both tables
and the UI fell back to the generic "License chưa dùng được trên máy này".

Consequence worth knowing: the deliberately upper-case source entries
(`TRIAL_NOT_FOUND`, `TRIAL_EXPIRED`, `TRIAL_REVOKED`, `WRONG_PRODUCT`, `REVOKED`,
`EXPIRED`) are only meaningful as **aliases**. `REVOKED`/`EXPIRED` collapse onto
the already-present lower-case `revoked`/`expired` — same message, so the
collision is harmless but the duplicate lines are dead weight.

### 2.1 `NEXT_STEP` — full table (26 keys after normalisation)

| Code | "Next step" shown to the customer |
|---|---|
| `trial_only` | Mã dùng thử: mở lại app và bấm "Nhập key" để kích hoạt |
| `hwid_mismatch` | Mã đã gắn máy khác. Vào xienhl.com → License của tôi → Đổi máy |
| `session_moved` | Tài khoản đang được dùng ở máy khác. Bấm "Đăng nhập lại" để lấy lại máy này. |
| `no_licence` | Tài khoản này chưa có gói nào. Vào xienhl.com để mua gói. |
| `revoked` | Mã đã bị thu hồi. Liên hệ hỗ trợ. |
| `expired` | Mã đã hết hạn. Mua/gia hạn tại xienhl.com |
| `trial_exhausted` | Máy bạn đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — vào xienhl.com, chọn gói và thanh toán. |
| `trial_expired` | Lượt dùng thử 1 giờ đã hết. Bấm "Thử MAP SÁNG" trên xienhl.com để lấy mã mới (mỗi máy còn nhiều lượt), hoặc mua key để dùng lâu dài. |
| `network` | Không kết nối được máy chủ. Kiểm tra mạng rồi bấm "Kiểm tra lại". |
| `offline_grace_expired` | Không kết nối được máy chủ quá lâu. Mở mạng rồi bấm "Kiểm tra lại". |
| `not_found` | Mã này không tồn tại. Kiểm tra lại từng ký tự — hay nhầm 8 với B, 0 với O, 1 với I, 5 với S. Hoặc lấy mã mới trên xienhl.com |
| `trial_not_found` | Mã dùng thử không đúng. Kiểm tra lại — hay nhầm 8 với B, 0 với O, 1 với I. Hoặc bấm "Thử MAP SÁNG" trên xienhl.com để lấy mã mới |
| `trial_expired` *(alias TRIAL_EXPIRED)* | Lượt dùng thử đã hết. Bấm "Thử MAP SÁNG" trên xienhl.com để lấy mã mới (mỗi máy còn nhiều lượt) |
| `trial_revoked` | Mã dùng thử đã bị thu hồi. Bấm "Thử MAP SÁNG" trên xienhl.com để lấy mã mới |
| `wrong_product` | Mã này của sản phẩm khác. Kiểm tra bạn mua Map sáng hay Tài nguyên |
| `trial_quota_exhausted` | Máy bạn đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — vào xienhl.com, chọn gói và thanh toán. |
| `trial_device_limit` | Máy này đã dùng hết lượt dùng thử. Vui lòng mua key để tiếp tục — vào xienhl.com, chọn gói và thanh toán. |
| `trial_ip_limit` | Kết nối/mạng này đã dùng hết lượt dùng thử hôm nay. Thử lại vào ngày mai, hoặc mua key tại xienhl.com để dùng ngay. |
| `trial_net_limit` | Mạng này đã dùng hết lượt dùng thử hôm nay. Thử lại vào ngày mai, hoặc mua key tại xienhl.com. |
| `trial_global_limit` | Hệ thống đã hết lượt dùng thử hôm nay. Thử lại vào ngày mai, hoặc mua key tại xienhl.com. |
| `trial_banned` | Thiết bị này không được dùng thử. Vui lòng mua key tại xienhl.com. |
| `trial_disabled` | Dùng thử đang tạm đóng. Vui lòng mua key tại xienhl.com. |
| `not_trial` | Đây là key trả phí, không phải mã dùng thử. Bấm "Nhập key" và dán đúng key đã mua. |
| `rate_limit` | Bạn thao tác quá nhanh. Chờ khoảng 1 phút rồi bấm "Kiểm tra lại". |
| `http_4xx` | Máy chủ trả lỗi tạm thời. Thử lại sau ít phút. |
| `http_5xx` | Máy chủ đang bảo trì. Thử lại sau ít phút. |

### 2.2 `STATE_TEXT` — the ● status line (26 keys)

| Code | Status line |
|---|---|
| `trial_only` | Mã dùng thử chưa kích hoạt |
| `hwid_mismatch` | License gắn máy khác |
| `session_moved` | Tài khoản đang dùng ở máy khác |
| `no_licence` | Tài khoản chưa có gói |
| `revoked` | License bị thu hồi |
| `expired` | License đã hết hạn |
| `trial_exhausted` | Đã hết lượt dùng thử |
| `trial_expired` | Đã hết lượt dùng thử |
| `network` | Không kết nối được máy chủ |
| `offline_grace_expired` | License chưa xác thực được |
| `not_found` | Mã không tồn tại |
| `trial_not_found` | Mã dùng thử không đúng |
| `trial_revoked` | Mã dùng thử bị thu hồi |
| `wrong_product` | Mã của sản phẩm khác |
| `trial_quota_exhausted` | Máy đã hết lượt dùng thử |
| `trial_device_limit` | Máy đã hết lượt dùng thử |
| `trial_ip_limit` | Mạng này đã hết lượt dùng thử |
| `trial_net_limit` | Mạng này đã hết lượt dùng thử |
| `trial_global_limit` | Hệ thống đã hết lượt dùng thử |
| `trial_banned` | Thiết bị không được dùng thử |
| `trial_disabled` | Dùng thử đang tạm đóng |
| `not_trial` | Đây là key trả phí |
| `rate_limit` | Thao tác quá nhanh |
| `http_4xx` | Máy chủ trả lỗi tạm thời |
| `http_5xx` | Máy chủ đang bảo trì |

Fallback when a code is not in `STATE_TEXT`: `'License không còn hiệu lực'`
(`state_text_for`, `:326-329`) — deliberately neutral, it does not blame the
machine.

Both tables are **complete and symmetric**: the Part 1 sweep of
`_scratch/doc-api/test_contract.py` reports no code present in one table but
missing from the other.

### 2.3 `error_code_of(text)` — `:193-305`

Accepts three shapes and returns a lower-case code (or `''`, which means "unknown —
do not guess", so the UI stays neutral instead of accusing the machine).

1. `code:<CODE>|<rest>` (the `xa_nofog_pro.check_online` format). Everything after
   `code:` is cut at the first of `|`, space, newline, tab, comma (`:209-215`).
2. A bare code matching any key of `NEXT_STEP`/`STATE_TEXT`, case-insensitively
   (`:228-231`).
3. Substring keyword scan, **order matters** (`:236-304`):
   `session_moved` → `no_licence`/`no_license` → `trial_not_found` →
   `trial_expired` → `trial_revoked` → `wrong_product` → `trial_only` →
   `hwid_mismatch` → `trial_exhausted` → `trial_quota_exhausted` → `not_found` →
   `revoked` → `expired` → `account_locked`.
   Then Vietnamese prose heuristics:
   * `không tồn tại` → `not_found`
   * `kết nối này`/`mạng này`/`hệ thống đã`/`hệ thống đạt` → `trial_ip_limit`
     (**checked before** `dùng thử`, because the server sentence contains both)
   * `dùng thử` → then `lượt` ⇒ `trial_quota_exhausted`, `đã hết` ⇒ `trial_expired`,
     `thu hồi` ⇒ `trial_revoked`, else `trial_not_found`
   * `hết lượt` ⇒ `trial_exhausted`, `hết hạn` ⇒ `expired`, `thu hồi` ⇒ `revoked`
   * account + (machine/other/login) ⇒ `session_moved` — **checked before**
     `máy khác`, because "Tài khoản đang được dùng ở máy khác" contains `máy khác`
     and classifying it as `hwid_mismatch` would tell the customer to "change
     machine" when the correct action is "log in again" (`:284-288`)
   * `chưa có gói` / `chưa có license` / `không có gói` … ⇒ `no_licence`
   * `máy khác` ⇒ `hwid_mismatch`
   * `sản phẩm khác`/`không dùng cho`/`mã tăng tài nguyên` ⇒ `wrong_product`
   * `network`/`urlopen`/`timed out`/`getaddrinfo`/`connection`/`mạng` ⇒ `network`

Verified against fabricated payloads in `_scratch/doc-api/test_contract.py` Part 2
(22 realistic server replies, all classified correctly).

### 2.4 `next_step_for(text)` — `:308-323`

`error_code_of(text)` then exact lookup, then case-insensitive scan, else `''`.
The test asserts that **every** key of `NEXT_STEP` yields a non-empty message (26/26).

### 2.5 `account_code_of(code)` — `:1270-1281`

Contextual remap used **only** when the entitlement was requested with a session
cookie rather than a pasted key. `not_found` / `no_license` / `no_licence` /
`no_licenses` / `license_not_found` / `licence_not_found` / `empty` → `no_licence`.
Everything else is lower-cased and passed through.

Rationale: the same `not_found` means "you typed the key wrong" (tell them about
8↔B confusion) when asked by key, and "this account has no plan" (tell them to buy)
when asked by session. Same code, two different remedies.

### 2.6 `entitlement_code(d)` — `:1284-1301`

Given a whole (normalised) entitlement dict, returns the single best status code:

```
session_moved(d)                    -> 'session_moved'
not d['ok']                         -> account_code_of(code or 'network')
d['features'] non-empty             -> ''            (healthy)
d['licenses'] non-empty             -> ''            (healthy)
via == 'session'                    -> 'no_licence'
otherwise                           -> ''
```

Verified in Part 5 of the test with 8 fabricated dicts, including a non-dict input
(`'garbage'` → `'network'`).

---

## 3. Local state

`state_dir()` (`:348-360`) = `%LOCALAPPDATA%\XArenaNoFog`, falling back to
`%TEMP%\XArenaNoFog`, then `XAArena`, then `.`. It **creates** the directory as a
side effect — which is why `purge_legacy_key_file()` deliberately does not call it
(`:692-694`).

| File | Path | Format | Encrypted | Contains | Secret? |
|---|---|---|---|---|---|
| `entitlement.json` | `state_dir()` | `XAENT1:` + DPAPI blob (legacy: raw JSON) | **yes**, Windows DPAPI (`CryptProtectData`, user-scoped) | whole last entitlement: features, licences, keys, username | **yes** — contains licence keys. DPAPI protects it. |
| `lic.bin` | `xa_nofog_pro.STATE_FILE` | `XANF` + DPAPI | yes | NoFog state: `key`, `xn_token`, `sites`, `expires_at`, `hwid`, trial fields | **yes** |
| `token.bin` | `xa_grant` | DPAPI | yes | tài-nguyên token `xg1.…` with payload `k` (the key) | **yes** |
| `session` cookie | `xa_nofog_pro` (`save_session`) | its own format | (owned by that module) | `mbk_session` value + username | **yes** — replayable credential |
| `last_check.json` | `state_dir()` | plain JSON `{"t": <float>}` | no | last successful server contact epoch | no (timestamp only) |
| `shop.lic` | `state_dir()` | `<b64 payload>.<b64 ECDSA sig>` | signature, not encryption | `{"h": "<hwid list>", "exp": <epoch>}` | no — HWID is not a credential, and it is signed so it cannot be forged |
| `shop.hwid` *(legacy)* | `state_dir()` | plain text, one HWID per line | no | old shop whitelist | **read no longer** — left behind, now ignored |
| `entitlement_key.txt` *(legacy)* | `state_dir()` | plain text, raw licence key | **no** | **the full licence key in plaintext** | **yes** — deleted at every startup and on logout |
| `arena_detail.log` | `%TEMP%` | text, scrubbed, ≤64 KB | no | technical trace, opt-in only | scrubbed, but see **L3** |
| `arena_update.log` | `%TEMP%` | text, scrubbed, ≤64 KB | no | update trace, opt-in only | scrubbed |

Verified by `_scratch/doc-api/probe_state.py`:

```
save_entitlement -> True
magic XAENT1:    : b'XAENT1:'
contains literal key in plaintext? False
first 40 bytes   : b'XAENT1:\x01\x00\x00\x00\xd0\x8c\x9d\xdf\x01\x15\xd1\x11\x8cz\x00\xc0O\xc2\x97\xeb\x01\x00\x00\x00\x13\xcd\x9au)4\x9aF\xa8'
load_entitlement round-trip: equal to input = True
legacy plain JSON -> load_entitlement(): {'ok': True, 'features': ['grant']}
save_entitlement with broken DPAPI -> False   (refuses; never writes plaintext)
last_check.json -> {"t": 1794780986.1736507}
```

### 3.1 DPAPI helpers

`_ent_crypt(data, encrypt=True)` — `:409-419`. Thin indirection onto
`xa_nofog_pro._dpapi_encrypt` / `_dpapi_decrypt`. Returns `None` on any failure
(module missing, attribute missing, DPAPI error), and never raises.

`save_entitlement(data)` — `:422-436`. Serialises to UTF-8 JSON, encrypts, and
writes `_ENT_MAGIC + ciphertext`. **If encryption is unavailable it returns
`False` and writes nothing** (`:430-433`) — the comment states the intent
explicitly: "thà mất cache còn hơn để lộ key". This is correct fail-closed
behaviour and was verified above.

`load_entitlement()` — `:439-461`. Reads the file; if it starts with `XAENT1:` it
decrypts; **otherwise it falls back to parsing the bytes as raw JSON**, which is
how machines installed before the change keep working. Next write re-encrypts.
Returns `{}` for missing/corrupt data — never raises.

Residual risk: the plaintext fallback path still *accepts* an attacker-written
`entitlement.json`. It does not *grant* anything by itself (the GUI still has to
respect `features`), but a customer can hand-craft cached features. See **M4**.

### 3.2 Manual key and the shop whitelist

`save_manual_key(key)` — `:524-535`. **RAM only** (`_MANUAL_KEY`, `:383`). It does
not touch the disk. The previous plaintext `entitlement_key.txt` is gone; the key
survives restarts because it already lives inside the DPAPI-protected `lic.bin`
and `token.bin`.

`load_manual_key()` — `:538-557`. Fallback chain:
1. `_MANUAL_KEY` (this process)
2. `_nofog_state_key()` — `state['key']` from `lic.bin` (`:464-474`)
3. `local_token_key()` — `xn_token` payload `k` (`:772-800`)
4. `_grant_token_key()` — `token.bin` payload `k`, trying
   `verify_token` → `parse_token` → raw payload decode in that order
   (`:477-521`), so an expired token still yields the key of *this* machine.

`clear_manual_key()` — `:560-567`. Clears RAM **and** deletes the legacy plaintext
file.

`machine_hwid()` — `:2077-2088`:

```python
try:    return str(_NF.compute_hwid() or '').strip().lower()   # nofog formula
except: pass
try:    return str(_NF._guard_safe_hwid() or '').strip().lower()   # <-- wrong module
except: return ''
```

`is_shop_hwid(hwid=None)` — `:2195-2204`. Fails closed: empty HWID ⇒ `False`;
membership test against `_shop_hwid_set()`.

`_shop_hwid_set()` — `:2183-2192`. 5-second cache over `_read_shop_lic()`.

`_read_shop_lic()` — `:2148-2180`. Reads `shop.lic`, splits on the first `.`,
base64-decodes payload and signature, **verifies the ECDSA P-256 signature**
(`_verify_shop_sig`, `:2131-2145`) against `SHOP_PUBKEY_B64` (`:2113-2114`), then
checks `exp`. Any failure returns an empty set. A list of comma-separated HWIDs may
be signed in one file.

See §6 for the D7 verdict on this gate.

### 3.3 Debug switch

| Item | Value / line | Meaning |
|---|---|---|
| `DEBUG_ENV` | `'XA_DEBUG'` `:583` | env var; `1/true/yes/on` turns tracing on |
| `DEBUG_FLAG` | `'--debug-log'` `:584` | CLI flag; the app converts it into `XA_DEBUG=1` for child modules |
| `LOG_MAX_BYTES` | `64 * 1024` `:585` | soft cap; on overflow the older half is dropped on a line boundary |
| `LOG_DETAIL` / `LOG_UPDATE` | `arena_detail.log` / `arena_update.log` `:586-587` | the two trace files |

`debug_on()` `:593-601` — true if `_DEBUG_ON` or the env var is set.
`set_debug(on)` `:604-608` — the `--debug-log` path; env still wins.

`scrub(text)` `:618-635` — applied to **every** line before it reaches disk:
tokens `xn1.`/`xg1.`, keys `TR-`/`AOE1-`/`XAGR-`, addresses `0x…`, long hex
(`[0-9A-Fa-f]{20,}` — this is what catches a HWID), and the `VA` label.
`debug_log(name, msg)` `:644-672` — absolute no-op when debug is off; truncates to
400 chars; never raises.

`cleanup_logs()` `:675-686` — deletes both trace files **only when debug is off**.
`purge_legacy_key_file()` `:689-705` — deletes `entitlement_key.txt` from both the
`XArenaNoFog` and `XAArena` folders without creating any directory.
`startup_hygiene()` `:708-724` — calls both, returns
`{'key_file_removed': bool, 'logs_removed': int}`.

### 3.4 Session handling

`session_cookie()` `:803-824` — tries `xa_nofog_pro.load_session` then
`read_session`, accepting either a `(token, username)` tuple or a bare string.
Returns `''` on anything unexpected.

Cookie header construction is `_cookie_header()` (`:731-743`); it is the only place
that knows the cookie's name, so `SESSION_COOKIE_NAME` (`:23`) is a **must-stay-in-sync
constant** with the server (`src/lib/auth.js`).

---

## 4. Entry point — `xa_arena_app.py`

### 4.1 `main()` order of operations (`:706-842`)

| Step | Lines | What happens |
|---|---|---|
| 1 | `:720-734` | **Debug flag + hygiene.** If `--debug-log` is present (case-insensitive) it calls `set_debug(True)`, sets `os.environ['XA_DEBUG']='1'` so child modules inherit the switch, then **removes the flag from `args` and from `sys.argv`** — otherwise `_has_cli_args()` would see an argument and open CLI mode instead of the GUI. Then `startup_hygiene()`. Whole block wrapped in `except Exception: pass`. |
| 2 | `:745-747` | `--version` / `-v` / `/v` / `/version` → print `APP_VERSION`, return 0. |
| 3 | `:748-753` | `--help` / `-h` / `/?` / `/help` → short usage, return 0. |
| 4 | `:755-756` | `--diag-update` → `diag_update()` (`:665-703`), prints JSON; writes `arena_diag.json` into `%TEMP%` **only when debug is on**, scrubbed. |
| 5 | `:765-775` | `--uninstall` → `xa_uninstall.gui_main(APP_VERSION)`; if the module is missing, a MessageBox and exit 1. |
| 6 | `:778-786` | **CLI dispatch** if `_has_cli_args(args)` → `_route_cli(args)`. Any exception → one fixed Vietnamese line, exit 1. |
| 7 | `:789-802` | **Single instance** (`acquire_single_instance()`), else raise the existing window (`focus_existing()`) or show a MessageBox, return 0. |
| 8 | `:812-816` | **Update gate** `update_gate()`; `False` ⇒ `os._exit(0)` so the `.bat` can replace a file Windows refuses to overwrite while running. |
| 9 | `:819-842` | **GUI**: import `xa_arena_gui` (ImportError ⇒ MessageBox, exit 3), then `gui.run_gui()`. |

Note the ordering consequence: **steps 6 (CLI) run before steps 7 and 8**, so the
single-instance mutex and the update gate do not apply to CLI invocations. See
**M2**.

### 4.2 CLI flags

App-level (handled in `main()`):

| Flag | Effect |
|---|---|
| *(none)* | GUI |
| `--debug-log` | enable tracing, then strip itself from argv; GUI still opens |
| `--version`, `-v`, `/v`, `/version` | print version, exit 0 |
| `--help`, `-h`, `/?`, `/help` | print usage, exit 0 |
| `--diag-update` | print update diagnostics JSON, exit 0 |
| `--uninstall` | run the uninstaller |
| `--key <KEY>` | `cli_activate_key()` (`:549-588`) — asks the server what the key is worth, then activates both products. Exit codes: 0 ok, 4 bad data, 5 network. |

`_has_cli_args()` (`:101-118`) treats anything starting with `-`, or a Windows-style
`/x` that is not an existing path and contains no further separators, as a flag.

### 4.3 `_DIAG_FLAGS` — and whether the fix is complete

`_route_cli()` (`:591-662`) first refuses diagnostic flags (`:633-649`):

```python
_DIAG_FLAGS = ('--list', '--dump', '--status-sites', '--sites',
               '--show-sites', '--hexdump',
               '/list', '/dump', '/sites', '/hexdump',
               '--status', '--selftest', '/status', '/selftest',
               '--off', '--deactivate',
               '--full', '--watch')
```

then routes module-starting flags (`:651-655`):

```python
grant_flags = ('--grant', '--stealth', '--check', '--rebind', '--hidden')
```

then defaults to NoFog (`main` or `run`).

**Verification requested by the brief — the previously broken flags now pass
through.** `--grant`, `--stealth`, `--check`, `--rebind`, `--hidden` are **not**
members of `_DIAG_FLAGS`; the diagnostic loop at `:639-649` cannot match them, so
they reach `grant_flags` at `:651-655` and `xa_grant.main()` is invoked. Confirmed
by literal set comparison. The regression described in the code comment
(`:621-632`) is fixed.

**However the list is still over-broad for two flags.** `--full` and `--watch`
are *not* diagnostics — they are working run modes of NoFog:

* `--full` sets `o['full']` (`xa_nofog_pro.py:4068-4069`) and is consumed by
  `pick_sites()` (`:4137-4139`): `if opts['full']: return t.full(), 'viewport+minimap+legacy'`
  — i.e. it patches the **additional** legacy gates. Blocking it silently downgrades
  the patch set.
* `--watch` sets `o['watch']` (`:4070-4071`) and drives the run-mode decision at
  `:4835`: `watch_mode = opts['watch'] and not once_mode`.

`--off` (`restore`), `--deactivate` and `--selftest` are defensible to block.
`--full` and `--watch` are not. See **M1**.

Correctly blocked (these really do print secrets): `--list` prints the whole patch
table `<key> 0x<addr> <orig> -> <patched>`; `--dump` prints per-slot memory state;
`--status` prints 8 characters of each licence's gate (the table at
`xa_nofog_pro.py:4075-4082` confirms these flags exist and are handled).

### 4.4 Update gate and the anti-loop logic

`update_gate()` (`:502-546`) is the single decision point, in this order:

1. `U.read_swap_result('XAArena')` — surface the previous swap outcome (`:516-523`).
2. `rollback_if_needed()` — `False`-return aborts the boot (`:525-530`).
3. `apply_pending_if_any()` — `True`-return means "scheduled, caller must exit"
   (`:532-537`).
4. `update_enforce()` — `False`-return means "scheduled, caller must exit"
   (`:539-544`).

`rollback_if_needed()` (`:482-499`) → `update_on_start()` (`:458-470`) →
`U.on_start()`; if the counter says the last boots never reached `GOOD_BOOT_SEC`
(60 s) twice (`MAX_BAD_BOOTS = 2`), `U.rollback_now()` restores the `.old` build.

`apply_pending_if_any()` (`:373-455`) — the anti-loop core:

* no pending file ⇒ `False`.
* server unreachable ⇒ keep `.new`, `False` (`:400-403`).
* server version **not newer** ⇒ delete `.new` and `False` (`:413-420`) — this
  prevents a downgrade.
* `.new` does not match the published size/SHA-256 ⇒ delete `.new`,
  `clear_attempts`, `False` (`:421-429`).
* `U.update_block_reason('XAArena', srv)` reports too many attempts ⇒ delete
  `.new` and `False` — **without** clearing the counter (`:430-443`). The comment
  at `:434-437` records why: clearing it lets `enforce_update()` believe nothing was
  ever tried, re-download 20 MB, and loop forever.
* otherwise `note_attempt(..., spawned=True)` then
  `apply_and_restart(...)`; success ⇒ `True`.

`update_enforce()` (`:292-370`):

* `_updater()` or `exe_path()` unavailable ⇒ allow running (`:302-310`).
* shows a **non-modal** `_ProgressBox` (`:195-279`) with a real percentage so the
  20–40 s download is not mistaken for a hang.
* exception ⇒ one fixed message, then **allow running** (`:336-343`).
* `st == 'error'` ⇒ one message naming the current version, then allow running
  (`:357-362`).
* final gate `:370`: `return st not in ('updating',)`. This is deliberately an
  allow-list-of-one-rejection: any unexpected status string means "keep running",
  whereas the old `return st != 'updating'` inverted the intent.

`exe_path()` (`:139-165`) — empirically documented: under Nuitka 2.x `--onefile`,
`sys.frozen` is `False` and `sys.executable` is the temp `python.exe`, while
`sys.argv[0]` is the real `.exe`. The function trusts `argv[0]` and explicitly
rejects anything under `onefile_` temp directories (`_is_onefile_temp`, `:130-136`).

Single instance: named mutex `Local\XArena_AllInOne_v1` (`MUTEX_NAME`, `:52`),
created via `CreateMutexW` with `ERROR_ALREADY_EXISTS` (183) detection, optional
foreground via `FindWindowW` over four candidate window titles (`:85-86`).

---

## 5. Constants

### 5.1 `xa_arena_api.py`

| Line | Name | Value | Meaning / sync requirement |
|---|---|---|---|
| 19 | `TIMEOUT` | `15` | default socket timeout for `GET /api/entitlement` |
| 23 | `SESSION_COOKIE_NAME` | `'mbk_session'` | **MUST match server** `src/lib/auth.js` exactly, or the server never sees the session |
| 34 | `NEXT_STEP` | dict, 28 source keys | error → next-action message; normalised to lower case at 177 |
| 133 | `STATE_TEXT` | dict, 28 source keys → 26 after normalising | error → short ● label; normalised at 178 |
| 180 | `_LAST_CODE` | `''` | last error code, process-global; set by `set_last_code` |
| 382 | `_LEGACY_KEY_FILE` | `'entitlement_key.txt'` | old plaintext key file; delete-only, never written |
| 383 | `_MANUAL_KEY` | `''` | RAM-only pasted key |
| 406 | `_ENT_MAGIC` | `b'XAENT1:'` | cache file prefix; **must stay in sync with `load_entitlement`** |
| 583 | `DEBUG_ENV` | `'XA_DEBUG'` | read by child modules too (`xa_grant`, `xa_nofog_pro`) |
| 584 | `DEBUG_FLAG` | `'--debug-log'` | stripped from argv in `main()` |
| 585 | `LOG_MAX_BYTES` | `65536` | trace file cap |
| 586-587 | `LOG_DETAIL`, `LOG_UPDATE` | `arena_detail.log`, `arena_update.log` | written under `%TEMP%` |
| 588 | `LOG_FILES` | tuple of the two | what `cleanup_logs()` deletes |
| 590 | `_DEBUG_ON` | `False` | in-process switch |
| 611 | `_RX_TOKEN` | `xn1.`/`xg1.` regex | scrub |
| 612 | `_RX_KEY` | `TR|AOE1|XAGR` + 2-4 groups | scrub — **case-sensitive, see L3** |
| 613 | `_RX_ADDR` | `0x…` | scrub |
| 614 | `_RX_HEX` | `[0-9A-Fa-f]{20,}` | scrub — catches HWIDs |
| 615 | `_RX_VA` | `VA` label | scrub |
| 1457 | `GRACE_SEC` | `259200` (3 days) | offline tolerance **must stay aligned with the shop's revocation policy**; longer = revoked keys keep working offline |
| 2064 | `BUY_BASE` | `'https://xienhl.com'` | `buy_url()` target |
| 2074 | `_SHOP_CACHE` | `{'at':0,'set':set()}` | 5 s cache |
| 2113 | `SHOP_PUBKEY_B64` | DER SPKI, P-256 | **must match the Cloudflare secret `SHOP_SIGN_KEY`'s public half**; rotating it invalidates every issued `shop.lic` |
| 2119 | `SHOP_LIC_NAME` | `'shop.lic'` | signed whitelist filename |
| 2285 | `TRIAL_LIMIT_DEFAULT` | `10` | display-only "N/10" when the server omits `quota`. **Must mirror server setting `trial1h_limit` (`src/lib/trial-quota.js`)**; it never grants turns |

### 5.2 `xa_arena_app.py`

| Line | Name | Value | Meaning / sync requirement |
|---|---|---|---|
| 40 | `_HERE` | this file's dir | sys.path bootstrap for `ui/`, `src/`, `grant/` |
| 49 | `APP_NAME` | `'XA ARENA'` | also the window title matched by `focus_existing()` |
| 50 | `APP_VERSION` | `'2.3.7.0'` | **must be ≤ the version published at `/api/app/version` for kind `arena`**, otherwise every launch self-updates |
| 52 | `MUTEX_NAME` | `'XArena_AllInOne_v1'` | **do not reuse across products**; the `_v1` suffix is the migration lever |

Cross-module constants that must stay aligned even though they are not in these
files: `xa_nofog_pro.API_BASE` (authoritative base URL), `xa_nofog_pro.STATE_FILE`,
`xa_nofog_pro.APP_NAME` / `CLIENT_VERSION` (sent in `/api/trial/claim`),
`xa_update`'s `MAX_APPLY_TRIES=2` / `MAX_BAD_BOOTS=2` / `RETRY_COOLDOWN_SEC=21600`.

---

## 6. Defects

Ranked by severity. **Nothing below was fixed by me** — every item is a
recommendation only. Findings that were fixed by another agent while this audit ran
are marked as such and kept for the record.

### D7 — the explicit answer: can a customer forge the shop whitelist?

**Before the mid-audit change: YES. After it: NO.**

The original gate (`_shop_hwid_set`, pre-change `:2093-2121`) read a **plain-text
file in a folder the customer fully controls** plus a **plain environment variable**,
with no signature and no server check. I proved the forgery end-to-end before the
file changed:

```
--- TEST 2 (ATTACK A): customer writes their OWN hwid to shop.hwid ---
    wrote  : '775c3fd37c703a3e3a1069cb...'
    is_shop_hwid(my) -> True
    RESULT : *** HOLE — CUSTOMER UNLOCKED THE PREMIUM FEATURE ***
--- TEST 3 (ATTACK B): customer sets XA_SHOP_HWIDS env var ---
    is_shop_hwid(my) -> True
--- TEST 5: _shop_hwid_set() references a server call?  False
             _shop_hwid_set() references a signature/HMAC? False
             -> whitelist is LOCAL-ONLY, unsigned.
```

The GUI gate is `_is_shop_machine()` → `_A.machine_hwid()` +
`_A.is_shop_hwid(hw)` (`xa_arena_gui.py:3258-3285`), so `True` here is enough to
render and enable the "Mua 2 tính 1" button on any machine holding a paid
`grant` licence.

The current code replaces that with a signed licence: `_read_shop_lic()`
(`:2148-2180`) verifies an **ECDSA P-256** signature over
`{"h": "<hwid>", "exp": <epoch>}` against `SHOP_PUBKEY_B64`, and the environment
variable is gone entirely. I attacked the new scheme directly
(`_scratch/doc-api/test_shop_gate.py`, 8/8 checks passed):

| Attack | Result |
|---|---|
| no `shop.lic` | `False` — fail closed |
| legacy `shop.hwid` containing own HWID | `False` — file no longer read |
| `XA_SHOP_HWIDS` env var | `False` — variable removed |
| signed with the **attacker's own** P-256 key | `False` — ECDSA holds |
| correct payload + garbage signature | `False` |
| unsigned payload (no `.`) | `False` |
| expired signed payload | `False` |
| **positive control**: point the pubkey at a key I control and sign | `True` (proves the verifier is real, not a stub) |

```
pubkey parse  : OK — secp256r1 256 bit  (real P-256 SPKI, not a placeholder)
SUMMARY: 8/8 checks passed
```

**Verdict: the business-critical hole is closed.** Residual conditions the shop
must be aware of:

1. `SHOP_PUBKEY_B64` (`:2113-2114`) is a source constant compiled into the exe. An
   attacker who patches the binary can substitute their own public key — but they
   still cannot mint a signature, so the effect is only to break the gate, not to
   unlock it. Acceptable.
2. **The gate now depends on the `cryptography` package being bundled.** If the
   packaged exe omits it, `_verify_shop_sig` raises `ImportError` internally,
   returns `False`, and **the shop owner himself loses the feature** (fail-closed
   but broken). `cryptography` 49.0.0 is present on this dev machine; I could not
   find a build spec in the repo that pins it. **Verify the Nuitka build includes
   `cryptography` before release** — see §8.
3. `exp = 0` or a missing `exp` means the licence **never expires** (`:2171-2173`
   only rejects when `exp` is truthy). Issue `shop.lic` files with an explicit
   expiry.
4. A stale `shop.hwid` from the old scheme is still left on customer machines. It
   is now ignored, but it should be deleted next to
   `purge_legacy_key_file()` for tidiness (not a security issue).

### H1 — Cached entitlement can make a *kicked* machine look licensed
`xa_arena_api.py:930-943` (guard at `:934-935`), with `_normalise` at `:1357-1359`.

`session_moved` **is** handled before the cache is consulted — but only for the
exact literal `code == 'session_moved'`. The same condition is expressible through
`isActiveDevice: false`, which `session_moved()` (`:1233-1247`) already understands
but which the error path never calls. If the server signals the kick that way while
returning any other code, the client falls through to the cache.

Produced with `_scratch/doc-api/test_cache.py` (fabricated reply, seeded cache):

```
--- 1. server: ok=false, code=session_moved (canonical)
    returned code 'session_moved', features None, served from cache: False
    MACHINE LOOKS LICENSED? False   VERDICT : PASS

--- 2. server: ok=false, isActiveDevice=false, code=not_found
    session_moved(reply) says: True
    returned ok True, features ['nofog','grant'], served from cache: True
    MACHINE LOOKS LICENSED? True <== DEFECT

--- 3. server: ok=true + isActiveDevice=false + features present
    returned features [] (wiped by _normalise)   -> safe
```

Scenario 3 confirms the `ok: true` path is safe because `_normalise` wipes
`features`. Only scenario 2 is broken — an asymmetric defence.

**Fix (not implemented):** in the `not d.get('ok')` branch replace
```python
if d['code'] == 'session_moved':
    return d
```
with
```python
if d['code'] == 'session_moved' or session_moved(d):
    try: os.remove(_ent_file())      # also drop the stale "licensed" cache
    except Exception: pass
    return d
```
and add a regression case for `{'ok': False, 'isActiveDevice': False, 'code': <any>}`.

### H2 — `machine_hwid()` fallback calls a function that does not exist (D6)
`xa_arena_api.py:2084-2088`.

```python
try:    return str(_NF._guard_safe_hwid() or '').strip().lower()
except: return ''
```
`_guard_safe_hwid` lives in **`xa_grant`**, not in `xa_nofog_pro`. Measured:

```
xa_nofog_pro has _guard_safe_hwid ? False
xa_grant     has _guard_safe_hwid ? True
nofog formula  compute_hwid()     = 775c3fd37c703a3e3a1069cb007ffb4e
grant formula  _guard_safe_hwid() = d512bc5a4c1e9b66cfc60be47ea75075
machine_hwid() when compute_hwid fails = ''
```

So the fallback silently degrades to "no HWID", and `is_shop_hwid('')` then fails
closed — the shop owner is locked out of his own feature on any machine where
`compute_hwid()` raises (`HwidUnavailable`, e.g. locked-down registry).

The two formulas are genuinely different, and the docstring at `:1540-1543` records
why sending the wrong one is fatal (`hwid_mismatch` on a valid licence).
`machine_hwid()` only ever returns the **nofog** formula, so a `shop.lic` must be
signed for the nofog HWID. `fetch_entitlement` sidesteps the whole problem
correctly by sending **both** (`:858-865`).

**Fix (not implemented):**
```python
try:
    import xa_grant as _XG
    return str(_XG._guard_safe_hwid() or '').strip().lower()
except Exception:
    return ''
```
(or simply `return _hwid_for('grant')`). Keep the nofog formula first, since the
shop licences are issued against it.

### M1 — `--full` and `--watch` are blocked but are working modes
`xa_arena_app.py:633-638` (the two names sit on `:638`).

`--full` changes the patch set (`xa_nofog_pro.py:4137-4139`) and `--watch` selects a
run mode (`:4835`). Returning exit 2 for them (`:639-649`) is the same class of
regression as the already-fixed `--grant`/`--check` bug — it removes a customer
feature rather than protecting a secret. `--list`, `--dump`, `--status` genuinely
dump the patch table and must stay blocked.

**Fix (not implemented):** delete `'--full'` and `'--watch'` from `_DIAG_FLAGS`.
Keep `--off`, `--deactivate`, `--selftest`, `--list`, `--dump`, `--status`,
`--sites`, `--hexdump` and the `/…` variants.

### M2 — CLI dispatch bypasses the update gate and the single-instance mutex
`xa_arena_app.py:778-786` returns through `_route_cli()` **before**
`acquire_single_instance()` (`:789`) and `update_gate()` (`:812`).

Consequence: `xa_arena.exe --grant` runs an outdated build that the shop's own rule
("luôn kiểm tra version trước khi chạy. Thấp hơn thì KHÔNG cho chạy") forbids, and
two CLI instances can run concurrently (each also bypassing the mutex).

**Fix (not implemented):** move the CLI branch after the mutex (or take a
CLI-specific mutex) and call `update_gate()` before `_route_cli()` for
module-starting flags, skipping it only for `--version`/`--help`/`--diag-update`.

### M3 — Full licence key travels in a URL query string
`xa_arena_api.py:911`, `:972`, `:1091` — plus `hwid`/`hwid2` at `:862-864` and
`:1087-1089`.

`GET /api/entitlement?key=<FULL KEY>` puts a bearer-grade secret in the request
line, which is routinely copied into web-server access logs, CDN logs, and any
TLS-terminating proxy. It is not visible to the customer, so it fails no
customer-facing test — but it is a real exposure of the paid product.

**Fix (not implemented):** accept the key in a POST body or an
`Authorization`-style header; keep GET for session-only lookups. If the server
cannot change, at minimum stop logging query strings for that route.

### M4 — `entitlement.json` still accepts an attacker-supplied plaintext document
`load_entitlement()` `:456-461`.

The DPAPI blob is safe, but the backward-compatible plaintext branch parses
whatever bytes are in the file. A customer can write
`{"ok": true, "features": ["nofog", "grant"]}` by hand and the cache will report
those features when the network path fails. `fetch_entitlement` then returns that
dict with `_cached: True` (`:937-942`). Severity is medium rather than critical
because the GUI's *functional* gate is the local token (`token_ok()` /
`grant_token_ok()`), which the cache cannot forge — but the licence panel will lie.

**Fix (not implemented):** bound the impact instead of removing compatibility —
when serving a cached entitlement, mark it `_cached=True` **and** require
`token_ok()` / `grant_token_ok()` before rendering either product as available; or
stamp the cache with an HMAC keyed by a DPAPI-protected secret so only genuinely
saved caches are honoured.

### L1 — `_status_box` is dead code and would hang if ever used
`xa_arena_app.py:168-178`. Zero references anywhere in `tool/` (verified). It wraps
a **modal** `MessageBoxW`, exactly the trap that `_route_cli` already works around
at `:642-644` ("MessageBox là MODAL, chạy không có người ngồi máy sẽ TREO vô hạn").
**Fix:** delete it.

### L2 — `quota_pair` is dead code
`xa_arena_api.py:2409-2415`. Zero references in runtime code (only tests). Its two
callers-in-spirit both call `quota_snapshot` directly. **Fix:** delete, or use it in
`EntitlementWorker` to replace the two ad-hoc slots at `xa_arena_gui.py:471-484`.

### L3 — `scrub()` does not redact lower-case licence keys
`xa_arena_api.py:612` — `_RX_KEY` has no `re.IGNORECASE`. Measured:

```
'key AOE1-1234-5678-9012 used'          -> 'key [key]'
'key aoe1-1234-5678-9012 LOWERCASE used' -> 'key aoe1-1234-5678-9012 LOWERCASE used'
```

Keys are upper-cased by `clean_key()` before use, so this needs an unusual code
path to hit — but any server message that echoes a key in lower case would land in
`%TEMP%\arena_detail.log` verbatim. **Fix:** add `re.I` to `_RX_KEY`.

### L4 — `session_moved` strips `features` but keeps `licenses[]`
`xa_arena_api.py:1357-1372`. A kicked machine's DPAPI cache keeps the account's
licence rows (and their keys) even though `features` is emptied. Not a functional
leak, but it retains data the server has already revoked for this device
(`test_contract.py` Part 6 prints `licenses[] is NOT wiped: ['XAGR-AAAA']`).
**Fix:** when `moved`, replace `licenses` with `[]` before `save_entitlement`.

### L5 — `machine_hwid()` runs registry/WMI work on the GUI thread
`xa_arena_gui.py:3264` via `_refresh_x2_button()` (`:2899`), which is called from
the entitlement-render path. `compute_hwid()` reads MachineGuid, BIOS serial, CPU
brand and volume serial (`xa_nofog_pro.py:557-577`, `:664-675`). Not a network
call, so the UI freezes for however long that takes, on every entitlement refresh,
rather than blocking on I/O. **Fix:** compute once at startup, cache in a module
global, and prefer `state['hwid']` the way `trial_hwid()` already does
(`xa_arena_api.py:2288-2307`).

### L6 — exceptions swallowed on customer paths (D2)

| Location | Swallowed | Effect on the customer |
|---|---|---|
| `xa_arena_api.py:970-1013` | the **entire** local-key merge, `except Exception: pass` | if the extra `/api/entitlement?key=<local>` call or the merge raises, `features` keeps only the account's set → **a customer whose local token works sees the module hidden**. This is the clearest "UI in the wrong state" case. |
| `xa_arena_api.py:1015` | return value of `save_entitlement(d)` ignored | cache silently not updated → a later offline launch shows a stale licence state |
| `xa_arena_api.py:1126-1132` | re-save of the session after login | login reports success but the session may not survive a restart → next launch asks to log in again |
| `xa_arena_gui.py:628-629` | `except Exception: okS, whyS = True, ''` around `server_recheck` | any failure inside the recheck is treated as "still valid" — **fail-open on revocation** |
| `xa_arena_app.py:812-816` | outer `except Exception` around `update_gate()` | a raising gate still falls through to the GUI, silently skipping version enforcement |

**Fix (not implemented):** narrow each `except` to the expected exception, log via
`debug_log`, and decide an explicit policy per site. For the GUI recheck, prefer an
explicit "unknown" state that keeps the licence but surfaces "chưa kiểm tra lại
được" rather than silently asserting validity.

### Timeout / retry handling (D5) — no defect found

Every network call originating from the GUI runs on a `QThread` subclass:
`UpdateCheckWorker` (`:327`), `UpdateDownloadWorker` (`:366`), `TokenWorker`
(`:391`), `FreeTrialWorker` (`:418`), `EntitlementWorker` (`:441`), `LoginWorker`
(`:490`), `PatchWorker` (`:511`), `GrantWorker` (`:753`). The 1-second UI timer
`_on_tick` (`:1563`) is documented and verified as network-free, and the polling
timer `_rt_tick` (`:1536`) only dispatches a worker.

Worst-case in-worker stalls (UI stays responsive, but the worker is stuck):
`_grant_recheck` 25 s (`api.py:1582`) → up to two `_post_json` calls at 20 s default
(`:2590`); `server_recheck` 12 s; `trial_left` 6 s. `_get_json`/`_post_json` do
**not** retry — the only retry in the chain is `NF._post(..., retries=1)` for
`/api/trial/claim` (`:1807`), which is a write and therefore correctly not
auto-retried more than once.

### Dead code (D1) — final, runtime-only

AST scan over both files cross-referenced against every call site in `tool/`
(excluding `_scratch/`, which holds historical patch scripts, not runtime code):

| File | Function | Lines | Verdict |
|---|---|---|---|
| `xa_arena_api.py` | `quota_pair` | 2409-2415 | **never referenced** |
| `xa_arena_app.py` | `_status_box` | 168-178 | **never referenced** |

Everything else is reachable: 75/77 functions in `xa_arena_api.py` and 18/19 in
`xa_arena_app.py`. Internal-only helpers confirmed reachable from within their own
file: `_nofog_state_key`/`_grant_token_key` (`load_manual_key`), `_as_bool3`
(`session_moved`, `_normalise`), `_prod_key` (`quota_from_entitlement`),
`trial_hwid` (`trial_left`), `_ent_crypt` (`save/load_entitlement`),
`cleanup_logs`/`purge_legacy_key_file` (`startup_hygiene`).

---

## 7. Static analysis

```
$ python -m pyflakes tool/app/xa_arena_api.py tool/app/xa_arena_app.py
(no output)
exit code 0
```

**Zero pyflakes warnings on both files.** The checker was proven live first — a
deliberate probe file produced the expected four findings
(`'os' imported but unused`, `'sys' imported but unused`,
`local variable 'x' is assigned to but never used`, `undefined name 'y'`), so the
clean result is genuine and not a silent no-op.

```
$ python -c "import ast; ast.parse(...)"
tool/app/xa_arena_api.py AST OK  bytes=105359 lines=2735
tool/app/xa_arena_app.py AST OK  bytes=31830  lines=853
exit code 0
```

Both files parse. `pyflakes` and `ast.parse` were re-run **after** the 05:17:18
external edit, against SHA-256 `508D51C2…` / `96AF96C6…`.

Note: "no pyflakes warnings" is weaker than it sounds here. `xa_arena_api.py`
imports `xa_nofog_pro`, `xa_grant` and `xa_grant_sec` **inside function bodies**, so
pyflakes cannot flag a wrong-module attribute — which is exactly how **H2**
survived.

---

## 8. What I could not verify

1. **Server-side truth.** I never contacted `https://xienhl.com`. Every request and
   response shape above is derived from the client's parsing code and its
   comments, not from observed traffic. Field names the client *tolerates*
   (`expiresAt` vs `expires_at`, `is_active_device`, flat vs per-product `trial`)
   are evidence that the real payload has varied — the server may send
   combinations not modelled here.
2. **Whether `cryptography` is bundled into the shipped exe.** It is importable on
   this dev machine (49.0.0) and there is no build spec in the repo to confirm the
   packaged build. **This now gates the shop owner's own feature** (D7 residual 2).
   No exe rebuild was performed, per instructions.
3. **Whether `SHOP_SIGN_KEY` exists and matches `SHOP_PUBKEY_B64`.** The public key
   parses as a valid P-256 SPKI, so it is a real key, but I cannot prove the
   matching private key is configured on Cloudflare.
4. **`xa_grant.ensure_engine()`'s internal call graph.** `/api/xg/heartbeat`,
   `/api/xg/rebind` and `/api/xg/violation` appear in
   `tool/grant/src/xa_grant_lic.py` and `xa_grant_sec.py`; I did not trace whether
   `xa_grant.ensure_engine()` reaches them from `ensure_grant_token`. §1.3 lists
   them as "present in the ecosystem, not called from these two files" — that
   statement is verified for a *direct* call only.
5. **Runtime behaviour of the GUI.** No PyQt6 session was launched; the GUI claims
   in §6 (worker-thread confinement, `_on_tick` network-free) are read from source,
   not observed.
6. **`session_cookie()`'s on-disk format.** It is owned by `xa_nofog_pro`;
   I verified the accessors it calls exist and the tuple-vs-string handling, but not
   the file's own encoding.
7. **The pre-change `shop.hwid` behaviour on real customer machines** — verified
   only in an isolated temp `LOCALAPPDATA`, deliberately, so the real machine was
   never modified.
8. **Which build first shipped the `XAENT1:` cache format.** `load_entitlement`
   keeps a plaintext branch for older installs; I cannot tell from source how many
   customers still carry a plaintext `entitlement.json`.

---

## 9. Test artefacts

All under `_scratch/doc-api/`, all runnable and already run:

| File | Purpose | Result |
|---|---|---|
| `test_contract.py` | 8-part contract proof: all 26 codes → Vietnamese messages, 22 fabricated server payloads through `error_code_of`, `account_code_of`, `entitlement_code`, `_normalise`, `_pick_key`, `clean_key` | **0 assertions failed** |
| `test_cache.py` | D4 cache/staleness probe with a seeded cache and fabricated replies | scenario 1 PASS, **scenario 2 DEFECT**, scenario 3 safe |
| `test_shop_gate.py` | D7 attack matrix against the current signed gate, including a positive control that the verifier is real | **8/8 passed** |
| `probe_hwid.py` | HWID formula comparison and the `_guard_safe_hwid` fallback probe (H2) | reproduced the empty fallback |
| `probe_state.py` | DPAPI round-trip, plaintext-leak check, `scrub()` coverage, written paths | cache contains no plaintext key |
| `probe_update.py` | `xa_update` surface and constants used by the anti-loop logic | all 13 functions present |
| `consts.py`, `fnmap.py`, `callsites.py` | constant/function/call-site extraction used for §5 and D1 | — |
| `snap/` | byte snapshots of both audited files at SHA-256 `508D51C2…` / `96AF96C6…` | — |
