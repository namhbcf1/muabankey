# APP-NOFOG — Audit: `xa_nofog_pro` / licence + auto-update

Scope of this document (read-only audit; **no product `.py` was modified**):

| File | Lines | Role |
|---|---|---|
| `tool/src/xa_nofog_pro.py` | 5169 | "map sáng" (no-fog) engine + local licence state + CLI + installer |
| `tool/src/xa_nofog_sec.py` | 684 | ECDSA token verify, site-table decryption, machine binding |
| `tool/src/xa_nofog_gui_qt.py` | 919 | PyQt6 GUI (resident mode of the standalone EXE) |
| `tool/src/xa_config.py` | 127 | operator-editable config |
| `tool/src/xa_nofog_const.py` | 20 | XOR-obfuscated constant blobs (generated) |
| `tool/ui/xa_update.py` | 1031 | auto-updater + rollback + anti-loop |

Line counts are raw `LF` counts (verified; `xa_config.py` and `xa_nofog_const.py` are the only CRLF files).
Evidence: `_scratch/doc-nofog/test_nofog_doc.py` (44 checks, **PASS 44 / FAIL 0**),
`_scratch/doc-nofog/deadcode.py`.

---

## 0. Verdict first (the three questions asked)

| Question | Answer |
|---|---|
| **Can `--once` auto-install into `C:\Program Files` without the customer saying yes?** | **No.** Chain proven in §5.4. Install additionally requires admin, and `--once` never creates shortcuts/tasks silently. |
| **Does `verify_token_local` fail closed when the machine binding is empty?** | **Partially — and the wording matters.** `verify_token_local()` itself does **zero** machine binding. The binding lives in `bind_token_to_machine()` and it **does** reject an *empty-string* HWID (prior bug fixed), **but silently skips the check when `hwid` is `None`** — and `_load_sites()` passes `st.get('hwid')`, which is `None` when the key is absent/`null`. See §6 d-6. |
| **Is `xa_nofog_gui_qt.py` dead code?** | **Dead in the arena build, alive in the standalone build.** `xa_arena.exe` can never reach it (proof in §3.5). `xa_nofog_pro.exe` (still shipped, `installer.js:46-50`) reaches it at `xa_nofog_pro.py:4917` and it is that product's *primary* GUI. So: not dead code overall, but redundant inside the arena app. |

---

## 1. How the app is wired (who calls what)

`xa_arena.exe` (`tool/app/xa_arena_app.py`) has its own GUI (`xa_arena_gui.py`) and calls **into**
`xa_nofog_pro` instead of running it. Every symbol the arena app touches (grep over
`xa_arena_api.py` / `xa_arena_gui.py` / `xa_arena_app.py`):

```
attach  apply_set  find_game  in_match  load_state  save_state
compute_hwid  _hwid_safe  _hwid_parts_checked  _load_sites  _require_sites
activate  check_online  start_trial  login_to_server  save_session
drop_session(*)  _dpapi_encrypt(*)  _dpapi_decrypt(*)   server_now  anchor_server_time
_post  _mono
const: APP_NAME  CLIENT_VERSION  HTTP_TIMEOUT  TRIAL_KINDS
(*) via getattr, xa_arena_api.py:413-414, 1156
```

`_guard_safe_hwid` (named in the task) **does not exist in `xa_nofog_pro.py`** — it is a
`xa_grant` function (`tool/grant/xa_grant.py:488`). `xa_arena_api.py:2086-2090` calls it as a
*fail-over* after `compute_hwid()`; that fail-over is dead (AttributeError → `except: return ''`).
In No-Fog the equivalents are `compute_hwid()` / `_hwid_safe()` / `_hwid_parts_checked()`.

`xa_arena_app.py:656-662` routes some CLI flags into `xa_nofog_pro.run()`, but
`xa_arena_app.py:633-649` **blocks** the diagnostic flags (`--list --dump --status --selftest
--off --deactivate --full --watch`) before they reach it.

---

## 2. `xa_nofog_pro.py` — public surface

"Blocks?" = can this call block/abort the GUI thread, or wait on the network/dialog.

### 2.1 Licence & state

| Function | Purpose | In | Out | Side effects | Blocks? |
|---|---|---|---|---|---|
| `load_state()` 695 | read+DPAPI-decrypt `lic.bin` | – | `dict` (never raises, `{}` on any error) | none | no |
| `save_state(st)` 716 | DPAPI-encrypt and atomically write `lic.bin` | dict | `True/False`, never raises | writes `lic.bin` (+`.tmp`), sets hidden attr `0x02` | no (sync disk write) |
| `_dpapi_encrypt` 438 / `_dpapi_decrypt` 451 | DPAPI CurrentUser wrap/unwrap | bytes | bytes / `None` | none | no |
| `compute_hwid()` 664 | `sha256('v1|guid|bios|cpu|vol')[:32]` | – | 32-hex | none | no |
| `_hwid_parts_checked()` 626 | parts + fail-closed guard | – | list of 4 | none | no |
| `_hwid_safe()` 635 | `compute_hwid()` that returns `''` instead of raising | – | hex or `''` | none | no |
| `compute_weak_hwid()` 678 | `sha256('w1|guid|bios|cpu')[:32]` | – | 32-hex | none | **dead code** (§6 d-17) |
| `activate(key, verbose, token)` 1105 | `POST /api/activate`, verify token locally, store state | key, token | `(bool, msg)` | writes `lic.bin`; prints masked HWID | **yes**, network (10 s) |
| `rebind_key(key, token)` 1034 | `POST /api/rebind` (move to new machine) | key, token | `(bool, msg)` | writes `lic.bin` | yes, network, 1 retry |
| `check_online(st, verbose)` 1183 | `POST /api/check`; refreshes `expires_at`, token, site table | state | `(bool, msg)`; msg is `code:xxx\|detail` on failure | writes `lic.bin`, sets global `SITES` | **yes**, network |
| `ensure_licensed(verbose)` 1788 | time-tamper check + `check_online` + table load | – | `(bool, msg)` | as above | **yes** |
| `trial_guard(verbose)` 1715 | periodic re-check used by resident loops | – | bool | network at most 1/<`TRIAL_RECHECK_SEC`> | yes |
| `ensure_session` 858 / `ask_login` 871 / `login_to_server` 834 | account session (cookies) | creds | cookie/user | writes `lic.bin` | **yes** (Tk dialog, 180 s timeout) |
| `start_trial(kind, verbose, product)` 1537 | `POST /api/trial/command` with **raw HWID parts** | kind `'1h'\|'3d'` | `{ok, code, msg, next, left, quota…}` | writes `lic.bin`, then calls `ensure_licensed()` internally (2nd network call) | **yes**, network ×2 |
| `is_trial(st)` 1236 | local flag test | – | bool | none | no |
| `show_status()` 4260 | `--status` printer | – | – | stdout; **calls `ensure_licensed()` → network** | yes |
| `_gui`/`ask_key_dialog` 4151/4230 | masked key entry (Tk) | – | key | clears clipboard | **yes**, modal |

Behaviour worth knowing:

* `load_state()`/`save_state()` never raise; callers that ignore the bool (`check_online`,
  line 1229) lose the refreshed token silently (§6 d-11).
* `STATE_DIR` is derived with `or` chains (237-243) to avoid the once-real bug of a *relative*
  path writing `lic.bin` into the CWD.

### 2.2 Game/patch surface

| Function | Purpose | Out |
|---|---|---|
| `find_game()` 2654 | Toolhelp32 snapshot, match `PROCESS_NAMES` | `[(pid, name)]` |
| `attach(pid)` 2798 | `OpenProcess(0x438)` + `EnumProcessModules` | `(handle, base)` or `(None, None)` |
| `in_match(h, base)` 2736 | "has the game actually entered a match?" via `[PTR_WORLD]` → `[+0x3F4]` | bool (**fail-closed**) |
| `patch(h, base, site, restore)` 2765 | the actual byte write, see §3 | `'patched'\|'restored'\|'ok'\|'unreadable'\|'write-fail'\|'other:<hex>'` |
| `apply_set(...)` 2814 | loop `patch()` over a site list | `(changed[], bad[])` |
| `rd/wr/write_at` 2675/2683/2691 | `ReadProcessMemory` / `WriteProcessMemory` / +`VirtualProtectEx`+`FlushInstructionCache` | bytes / bool |
| `dump_state` 2936, `list_sites` 2953, `selftest` 2834 | diagnostic printers (see §6 d-3, d-10) | stdout |
| `run()` 4608 | CLI dispatch + **the resident poll loop** (5062-5165) | exit code |

The resident loop (`run()` 5062-5165) per iteration:
`trial_guard()` (only every `TRIAL_RECHECK_SEC`) → `find_game()` → if none: close handle, print
`ĐÃ ĐÓNG GAME HÃY MỞ LẠI`, `sleep(RESIDENT_POLL)` → `attach()` when pid changes →
`apply_set(...)` **once** → set `patched_pid` → `sleep(RESIDENT_POLL)`. While
`pid == patched_pid` and the handle is alive it does **nothing** (that is the "patch once per
game run" design). It blocks on `time.sleep` by design; it is the console fallback when
PyQt6 is unavailable.

---

## 3. The memory patch — the most dangerous code in the app

### 3.1 What it patches

It does **not** touch any file on disk. It writes bytes into the memory of the running
`EMPIRESX*.EXE` process with `WriteProcessMemory`, so that fog/render paths return early
("map sáng"). 17 "cổng" (gates) in 3 groups — `viewport`, `minimap`, `legacy` — each a tuple
`(key, va, orig_hex, pat_hex)`; 1–16 bytes each (`xa_nofog_sec.py:296-297`).

**No gate address or byte exists in any source file or in the EXE.** They arrive only inside
the ECDSA-signed server token as an XOR/SHA-256-keystream ciphertext block (`sv`), keyed by a
per-licence `gate` (`ss`) — `xa_nofog_sec.py:300-349`. `SITES = None` (2044) until
`_load_sites()` decrypts it; every consumer goes through `_require_sites()` (2223) and raises
`SitesUnavailable` rather than "patch somewhere".

### 3.2 How the addresses are found

```
token (signed)  --verify_sig-->  payload{ss=gate, sv=ciphertext}
                --keystream SHA256("xn-ks"||gate||u32be(block))-->  {"s":[[key,group,va,orig,pat],…]}
                --SiteTable() validation-->  SITES
va  (absolute, game image assumed at PREFERRED_BASE = 0x400000)
addr = base + (va - PREFERRED_BASE)          # pro.py:2772, 2938
base = mods[0] from EnumProcessModules       # pro.py:2804-2811
```

`SiteTable.__init__` (`xa_nofog_sec.py:362-419`) is a real validator, not a parser: rejects
duplicate keys, duplicate addresses, unknown group, `va` outside `0x400000..0x08000000`,
`len(orig) != len(pat)`, `orig == pat`, >128 rows, non-hex, and a plaintext that does not
start with `{` (so a patched payload decoder cannot "return []").

### 3.3 What happens if the game version differs

This is the key safety property and it is **good** — but partly by accident:

* `patch()` (2775-2784) **reads the current bytes first** and only writes if they are exactly
  the expected pair:
  * `cur == want` → `'ok'` (already done)
  * `cur == other` → write
  * anything else → **`'other:<hex>'`, no write at all**
  So a stale table cannot garble a new build: the tool refuses and reports
  `LỖI MỞ MAP: <key>(other:..)`, retried every poll. The game is not corrupted.
* The gate between "menu" and "in match" (`in_match()`, 2736-2762) is **hard-coded**, *not*
  from the token: `PTR_WORLD = 0x00585E88` (2721) and `OFF_MANAGER = 0x3F4` (2722). If a new
  game build moves the world pointer, `in_match()` returns `False` forever → **the tool goes
  silent: no patch, no error**, only "Chờ vào trận…". Fail-closed (never writes garbage) but
  it looks like a dead tool to the customer.
* `xa_grant` handles the same structure *differently*: `PTR_WORLD = 0` then
  `PTR_WORLD = A('PTR_WORLD')` from its token (`xa_grant.py:120,278`). So on a game update,
  XAGrant follows the server automatically and No-Fog does **not**. See §6 d-20.

### 3.4 How it restores bytes

Only two paths restore:

* `--off` (`run()` 4947-4954, 4999-5000): needs an **open game process**, otherwise
  `"Game khong chay -- khong co gi de tra goc."` (5082-5083). Ctrl-C does **not** restore
  (5159-5164, deliberate: "tranh lam game out").
* The Qt GUI's stop path: `PatchWorker._restore_patches()` (`gui_qt:309-335`) and its
  "left the match" transition (250-259).

`write_at()` (2691-2704) is the only writer: `VirtualProtectEx(PAGE_EXECUTE_READWRITE)` →
**one** `WriteProcessMemory` of the whole run → restore the old protection → `FlushInstructionCache`.

### 3.5 Failure modes (asked explicitly)

| Event | Is anything left patched? | Consequence |
|---|---|---|
| Game crashes / exits | **No.** The patch lives only in that process's pages. | Next launch is mathematically clean; nothing to restore. |
| Power loss / BSOD | **No** (process memory is gone). | Nothing on disk was modified. |
| Tool force-killed (`taskkill /F`) while game runs | **YES — the game stays patched.** | Fog stays off until the game restarts; the tool cannot un-patch a dead handle. Detectable by a game-side checksum/anti-cheat, and the customer cannot turn it off without restarting the game. |
| Tool killed *during* `WriteProcessMemory` | possible partial instruction | **Torn write.** `write_at` does **not** suspend the game's threads (no `SuspendThread`/`GetThreadContext` anywhere in the file — verified by grep), so the engine can be executing the exact bytes being replaced. A 1–16 byte overwrite torn by a kill, or executed mid-write, can crash the game. Mitigation in place is *only* timing: patch once, right after the game starts, before lockstep (module docstring 48-50) and gated on `in_match()`. |
| Table stale (game updated) | no write happens | Tool reports `LỖI MỞ MAP`, loops. Safe. |
| `SITES` is `None` (token invalid mid-session) | `patch()` raises `SitesUnavailable` from `_require_sites()` | **Not caught** in the console loop (5125) → traceback out of `run()`. In practice `trial_guard()`/`ensure_licensed()` returns first, but the ordering is fragile (§6 d-19). |

**Net:** the patch is *not* persistent, so the "bytes restored after crash/power loss" question
is moot — the danger is a **live client running modified code with nobody able to revert it**,
plus the absence of thread suspension during the write.

---

## 4. The trial state machine

### 4.1 What lives where

Local, in `%LOCALAPPDATA%\XArenaNoFog\lic.bin` (DPAPI **CurrentUser**, i.e. re-encryptable by
the same user), header `XANF` + ciphertext:

`key, hwid, xn_token, expires_at, activated_at, plan, is_trial, trial_kind, trial_label,
trial_started, hold_until, grace_hours, last_ok, mono_last_ok, mono_high, srv_ts, mono_at,
clock_tampered, recheck_sec, quota, quota_used, quota_left, quota_total, acct_cookie, acct_user, acct_at`

Server-authoritative (`/api/check`, `/api/activate`, `/api/trial/command`):
key validity/revocation, **the machine binding**, `expires_at`, `activated_at`, `plan`,
`min_ver`, the **whole site table** (inside the token), and the trial **quota counter**
(per HWID, per product: `1h:nofog`, `1h:xagrant`…).

### 4.2 Can a local edit grant a free trial?

**No — provided the server is reachable.** `REQUIRE_ONLINE = True` (`xa_config.py:127`) makes
`_grace_left()` return `0` unconditionally (1250-1251), so there is no offline path at all, and
every run ends in `/api/check`, which **overwrites** `expires_at`, `activated_at`, `plan`,
`grace_hours` (1216-1223). A trial additionally requires the server to *issue* a trial key, and
the site table cannot be decrypted without a valid signed token (keygen gives garbage), while
`SiteTable` rejects garbage.

Residual local levers (all limited, none give a free trial):

* `clock_tampered` / `mono_high` / `ts` / `HKCU\…\XASupport\LastRun` are local anti-rollback
  anchors — deleting them only resets *tamper detection*, and the server's `now` anchor
  (`_time_anchor`, monotonic) is the primary layer.
* **The real hole** is the `hwid=None` short-circuit in `bind_token_to_machine` (§6 d-6), which
  re-opens "copy `lic.bin` to another machine" for someone who can re-encrypt their own DPAPI
  blob. That is licence sharing, not a free trial.

---

## 5. `xa_update.py` — complete map

### 5.1 Function reference (line numbers)

| Function | Line | Purpose / contract |
|---|---|---|
| `state_dir(app_name)` | 102 | `%LOCALAPPDATA%\<app>`; `makedirs`, swallows errors |
| `_boot_file/_read_boot/_write_boot` | 113/117/127 | `boot_count` = `{count,pid}` JSON |
| `update_state_file/read_update_state/_write_update_state` | 135/140/149 | `update_state.json` |
| `swap_result_file/read_swap_result` | 157/162 | `swap_result.txt`; **read deletes it** |
| `pending_file/old_file` | 183/187 | `<exe>.new` / `<exe>.old` |
| `file_sha256/same_bytes` | 191/206 | streaming hash / size+hash compare |
| `cleanup_stale(exe,app)` 218 | | delete `.new.part`, `.part`, `.new.tmp`, stale `.bad`(>24 h), stale `.new`(>24 h), and **`.old` when provably useless** (EXE already == `applied_sha`, or identical, or >7 days). Returns count. |
| `has_pending(exe)` | 292 | `.new` exists |
| `pending_matches(exe, info)` | 297 | `.new` size **and** sha equal the server's |
| `note_attempt(app, ver, spawned)` | 318 | increments `attempts`; at `MAX_APPLY_TRIES` sets `blocked_until = now+6 h`; a **new** `ver` resets the counter |
| `clear_attempts(app)` | 341 | `attempts=0, blocked_until=0, version=''` |
| `update_block_reason(app, ver)` | 350 | `''` = allowed, else `"đã thử N lần cho bản X"` |
| `confirm_installed(app, exe)` | 365 | `sha256(exe)==applied_sha` → **deletes `.old`**, zeroes boot counter, clears marker+attempts |
| `check(api_base, kind)` | 413 | GET `/api/app/version` (or `/api/setup/version` when `kind='setup'`); enforces **https + host allow-list** (`ALLOWED_HOSTS`, 72) |
| `version_tuple/is_newer` | 472/490 | every digit-run, in order (`'v2.10' → (2,10)`) |
| `download(info, exe, on_progress)` | 522 | reuses a correct `.new`; checks free space (`size × 1.2`); writes `.new.part`; verifies size **and** sha; `os.replace → .new` |
| `_bat_path/_write_bat/_spawn_bat` | 611/616/644 | temp `.bat`, **UTF-8 with BOM**, detached `cmd /c` |
| `_remember_applied` | 663 | writes `applied_sha/size/version` **before** the swap |
| `apply_and_restart(exe, wait_ms, info, app)` | 688 | generate+spawn the swap script |
| `_swap_lines(...)` | 746 | the swap `.bat` (verbatim §5.2) |
| `enforce_update(api, kind, ver, exe, on_status, allow_offline, app)` | 820 | `ok` / `updating` / `error`; **fail-open** offline; honours `update_block_reason`; progress throttled to 10 % |
| `on_start(app, exe_path=None)` | 913 | boot accounting → `(count, should_rollback)` |
| `mark_good(app)` | 963 | zero the boot counter |
| `rollback_now(exe, app)` | 968 | `.old → exe` via a second `.bat` (verbatim §5.4) |

### 5.2 The generated `.bat` — verbatim

Output of `_swap_lines()` rendered by the test run (paths are the real substituted values; the
file is written **UTF-8 with BOM**, CRLF; `%N%` is the retry counter):

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal enableextensions
rem Cho tien trinh cu thoat han (moi lan ping ~1 giay)
ping -n 2 127.0.0.1 >nul
rem Ban moi phai con day du, neu khong thi KHONG dung vao ban cu
if not exist "<EXE>.new" goto nonew
rem (1) doi ten ban cu -> .old  (Khong xoa gi ca)
set "N=0"
:try1
del /f /q "<EXE>.old" >nul 2>&1
move /y "<EXE>" "<EXE>.old" >nul 2>&1
if not exist "<EXE>" goto renamed
set /a N+=1
if %N% GEQ 30 goto giveup
ping -n 2 127.0.0.1 >nul
goto try1
:giveup
>"<STATE>\swap_result.txt" echo fail-khong-doi-ten-duoc-exe
rem Chua dong vao gi -> ban cu van nguyen, chi can mo lai
if exist "<EXE>" start "" "<EXE>"
goto done
rem (2) dua ban moi vao cho trong
:renamed
move /y "<EXE>.new" "<EXE>" >nul 2>&1
if exist "<EXE>" goto swapped
>"<STATE>\swap_result.txt" echo fail-khong-chep-duoc-ban-moi
rem (3) ban moi that bai -> tra ban cu ve dung cho
move /y "<EXE>.old" "<EXE>" >nul 2>&1
if not exist "<EXE>" copy /y "<EXE>.old" "<EXE>" >nul 2>&1
if exist "<EXE>" start "" "<EXE>"
goto done
:swapped
>"<STATE>\swap_result.txt" echo ok
start "" "<EXE>"
goto done
:nonew
>"<STATE>\swap_result.txt" echo fail-thieu-ban-moi
if exist "<EXE>" start "" "<EXE>"
:done
del /f /q "%~f0" >nul 2>&1
endlocal
```

Line-by-line:

| Line | Why |
|---|---|
| `@echo off` | no console noise (`cmd` runs detached, windowless) |
| `chcp 65001` | UTF-8 code page so non-ASCII paths survive |
| `setlocal enableextensions` | `set /a`, `goto` labels |
| `ping -n 2 127.0.0.1` | ~1 s sleep (the script has no `timeout` because it needs no console). `-n 2` = 1 ping + 1 wait ≈ 1 s; `apply_and_restart(wait_ms=1500)` → `init_ping = 1500//1000 = 1` → `-n 2` |
| `if not exist "<EXE>.new" goto nonew` | **guard**: never touch the old EXE without a new one |
| `del .old` before `move` | an older `.old` would make `move /y` fail |
| `move /y "<EXE>" "<EXE>.old"` | Windows forbids `del`/`copy`/`move` **onto** a running `.exe` but **allows renaming it** (measured, docstring 20-26). This is a **rename, never a delete** |
| `if not exist "<EXE>" goto renamed` | success test = the exe path is now empty |
| `set /a N+=1`, `if %N% GEQ 30 goto giveup` | **`BAT_MOVE_RETRIES = 30`** attempts ≈ 30 s of retrying, because AV/indexer can hold the file for seconds |
| `:giveup` | old EXE still in place, write `swap_result.txt`, relaunch it |
| `:renamed` → `move .new → EXE` | second half of the atomic-ish swap |
| failure of that move | `swap_result.txt`, then **put `.old` back** (`move`, and `copy` as a second chance) |
| `:swapped` | `echo ok`, relaunch |
| `:done` → `del "%~f0"` | self-delete. **Side effect:** cmd loses the script mid-read and prints `The batch file cannot be found.` and the script exits **1**; that is expected, `swap_result.txt` is the real signal |
| `endlocal` | normally never reached (see above) |

**`swap_result.txt` values**: `ok`, `fail-thieu-ban-moi`, `fail-khong-doi-ten-duoc-exe`,
`fail-khong-chep-duoc-ban-moi`, and (rollback) `rollback`, `rollback-fail`,
`rollback-fail-exe-dang-khoa`. It is read-and-deleted by `read_swap_result()` (162).
The **only** consumer is `xa_arena_app.py:519` (`U.read_swap_result('XAArena')`) — i.e. the
arena build reads it, and **`xa_nofog_pro.py` never does**: the standalone No-Fog EXE writes a
result file that nobody on its own side inspects. Because both products default to
`app_name='XAArena'`, the arena app can even consume and delete a swap result produced by the
No-Fog EXE in the same profile (§6 d-2).

### 5.3 Anti-loop protection — what resets what

```
MAX_APPLY_TRIES = 2      (89)        # 1 automatic + 1 backup (AV may release late)
RETRY_COOLDOWN_SEC = 6h  (92)
MAX_BAD_BOOTS = 2        (78)        # rollback after 3 consecutive bad boots (>2)
GOOD_BOOT_SEC = 60       (81)        # read by NOBODY in this file (§6 d-18)
```

| Trigger | Effect on `attempts` | Effect on `blocked_until` | Effect on `boot_count` | Effect on `.old` |
|---|---|---|---|---|
| `note_attempt()` same version | `+1` | `now+6 h` at ≥2 | – | – |
| `note_attempt()` **new** version | reset to 0 | 0 | – | – |
| `clear_attempts()` | 0 | 0 | – | – |
| spawn of the `.bat` failed | **clear_attempts()** (742) | 0 | – | `.new` deleted |
| `confirm_installed()` matches | 0 | 0 | 0 | **deleted** |
| `mark_good()` (60 s alive) | – | – | 0 | – |
| `rollback_now()` | 0 | 0 | 0 | consumed by the rollback |

The loop that was reported ("app cứ chạy đi chạy lại") is closed by four independent things:
a correct `.new` is **reused** (`pending_matches`, 536), attempts are counted **before** exit
(905), the cooldown makes the 3rd launch skip the update, and `confirm_installed()` proves the
new build actually ran so a good build is never rolled back.

Verified by the test (§8): attempt 1 → allowed; attempt 2 → blocked with
`đã thử 2 lần cho bản 1.5.0.0`; a newer server version → allowed again.

### 5.4 `rollback_now` — does it delete the only working exe? **No.**

The prior bug was `del <exe>` then `move .old <exe>`. The current script (993-1021):

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal enableextensions
ping -n 4 127.0.0.1 >nul
if not exist "<EXE>.old" goto done
rem (1) doi ten ban loi -> .bad (giu lai de chan doan, KHONG xoa)
move /y "<EXE>" "<EXE>.bad" >nul 2>&1
if exist "<EXE>" goto locked
rem (2) dua ban cu ve dung cho (duong dang trong)
move /y "<EXE>.old" "<EXE>" >nul 2>&1
if exist "<EXE>" goto restored
rem (3) that bai -> tra lai dung ban dang chay truoc do
move /y "<EXE>.bad" "<EXE>" >nul 2>&1
>"<STATE>\swap_result.txt" echo rollback-fail
if exist "<EXE>" start "" "<EXE>"
goto done
:restored
>"<STATE>\swap_result.txt" echo rollback
del /f /q "<EXE>.bad" >nul 2>&1
start "" "<EXE>"
goto done
:locked
>"<STATE>\swap_result.txt" echo rollback-fail-exe-dang-khoa
start "" "<EXE>"
:done
del /f /q "%~f0" >nul 2>&1
endlocal
```

* There is **no `del` of `<exe>` anywhere in the script** (asserted by the test: only
  `<exe>.bad` and `%~f0` are deleted).
* Branch coverage: locked → exe untouched; normal → `.bad` rename then `.old` back;
  double failure → `.bad` restored to the exe path. Tested end-to-end on real files (fake
  bytes): EXE exists afterwards and equals the **old** build.
* **Residual gap (documented, not fixed):** if *both* `move exe→.bad` succeeds **and**
  `move .old→exe` fails **and** `move .bad→exe` also fails, the exe path is momentarily empty
  and no `start` runs. Recovery is manual (`*.old` / `*.bad` are still on disk). This needs two
  simultaneous filesystem failures, and it is strictly better than the old `del`-first version.
* `rollback_now` also short-circuits safely: no `.old` → `False`; `.old` byte-identical to the
  exe → `False` (both return **before** any script is generated — verified).

### 5.5 Exact sequence — update SUCCEEDS

1. `run()` → resident mode → `update_on_start()` (4856) → `on_start()`: no marker, no `.old`
   → `(0, False)`, boot counter zeroed.
2. `update_enforce()` (4883) → `enforce_update()`.
3. `check()` → `GET https://xienhl.com/api/app/version`, host+https asserted, node
   `nofog` = the whole body. `is_newer(server, '1.5.0.0')` → True.
4. `update_block_reason()` → `''` (first attempt).
5. `pending_matches()`? no → `download()`: free-space check, stream to `.new.part`, size and
   SHA-256 must match, `os.replace` → `<exe>.new`.
6. `_remember_applied()` → `update_state.json{applied_sha, applied_size, applied_version}`.
   **This happens before the swap, so the next start can prove the swap worked.**
7. `_write_bat()` (UTF-8+BOM) → `_spawn_bat()` (detached `cmd /c`).
8. `note_attempt()` → `attempts = 1`.
9. `enforce_update` returns `'updating'` → `update_enforce` returns `False` →
   `run()` calls `os._exit(0)` (4885). The GUI never opens. The app is gone; the `.bat` proceeds.
10. `.bat`: waits ~1 s, renames `<exe>`→`<exe>.old`, moves `<exe>.new`→`<exe>`,
    writes `swap_result.txt = ok`, relaunches the new EXE, deletes itself.
11. Next launch: `on_start()` → `confirm_installed()` → `sha256(exe) == applied_sha` →
    **`.old` deleted**, boot counter zeroed, marker/attempts cleared → `(0, False)`.
12. `update_enforce()` → server version == client version → `'ok'` → GUI opens with no
    download. `cleanup_stale()` (called by `xa_arena_gui.py:1089`) finds nothing left over.
    After 60 s the GUI calls `update_mark_good()`.

### 5.6 Exact sequence — update FAILS

| Failure point | What happens | Customer impact |
|---|---|---|
| `check()` network/parse error | `allow_offline=True` → `'ok'` | tool runs normally (deliberate fail-open) |
| URL not https / wrong host | `{'ok': False}` → fail-open | runs; a tampered version endpoint cannot redirect the download |
| `is_newer` false | `'ok'` | no download |
| `update_block_reason` non-empty | `'ok'` + status "Bỏ qua cập nhật" | 2 attempts already spent → 6 h quiet period |
| disk < `size × 1.2` | `'error'` | `update_enforce` returns **True** → tool still runs (§6 d-14 nuance) |
| size or SHA-256 mismatch | `.part` deleted, `'error'` | runs; next launch retries (attempts not incremented — nothing was scheduled) |
| `.bat` cannot be created / spawned | `.new` **deleted**, `clear_attempts()`, `'error'` | runs; **20 MB re-downloaded on every launch** while spawn keeps failing (§6 d-13) |
| `.bat` runs but the old EXE is locked >30 s | `swap_result.txt = fail-khong-doi-ten-duoc-exe`, old EXE relaunched | app works, nothing changed; next launch: attempts=2 → blocked 6 h |
| `.new` vanished before the script ran | `fail-thieu-ban-moi`, old EXE relaunched | app works, untouched |
| `.new` move fails | `.old` moved back (+`copy` fallback), old EXE relaunched | app works, untouched |
| new build starts but crashes immediately | boot counter 1, 2 (only when a *different* `.old` exists) → 3rd start asks for rollback | **in the standalone No-Fog build this never fires** (§6 d-1) |

---

## 6. Defects, ranked (line numbers + fix, **not implemented**)

### HIGH

**d-1 — The crash-rollback safety net is inert in the standalone No-Fog build.**
`xa_nofog_pro.py:2199-2210`: `update_on_start()` calls `U.on_start(app_name)` **without**
`exe_path`; `on_start(app_name, exe_path=None)` then does `exe_path = ''` (927) and returns
`(0, False)` at 939 — unconditionally, *after* zeroing the boot counter. So
`run():4856-4871` can never roll back. Proven by test (e).
*Fix:* `return U.on_start(app_name, _launcher_path())`; add a unit test asserting
`on_start(app, exe)` is reached from `update_on_start`.

**d-2 — Two different state directories for the same update (and one shared file).**
`update_apply()` (2133-2144) → `U.apply_and_restart(exe)` uses `DEFAULT_APP = 'XAArena'`,
while `update_on_start`/`update_mark_good` use `'XArenaNoFog'`. `applied_sha` and `attempts`
are written to `%LOCALAPPDATA%\XAArena\` and read from `%LOCALAPPDATA%\XArenaNoFog\` →
`confirm_installed()` always returns `'chua co marker ban moi'`, so `.old` is never cleaned
and a good build would be treated as unconfirmed even after d-1 is fixed.
Worse, because the arena app *also* uses `'XAArena'` (`xa_arena_app.py:519` reads and deletes
`XAArena\swap_result.txt`), a No-Fog swap result can be consumed by the arena app in the same
user profile, and vice-versa.
*Fix:* one `UPDATE_STATE_APP` constant per product, passed explicitly by every wrapper.

**d-3 — `--list` prints the entire patch table on a customer machine.**
`list_sites()` 2953-2978 prints `key 0x<VA> <orig> -> <pat>` for every gate. It only needs a
valid token, i.e. **any trial user**. This is the single secret the whole token design exists to
protect (`xa_nofog_sec.py:9-23`), and `xa_arena_app.py:610-617` already records that this exact
leak was measured on a released EXE and blocked *there* — but nothing blocks it in
`xa_nofog_pro.exe`, which is still shipped (`installer.js:46`).
*Fix:* drop `--list` from `parse_args`/`run` in release builds (or gate on an env var that the
installer never sets) and delete `list_sites`/`dump_state` from the shipped surface.

**d-4 — Code bytes are written into a live process with no thread suspension.**
`write_at()` 2691-2704: `VirtualProtectEx` → `WriteProcessMemory` → restore → `FlushInstructionCache`.
No `SuspendThread`/`GetThreadContext` exists in the file (grep-verified). The engine can be
executing the bytes being replaced; a multi-byte instruction can be observed half-written.
*Fix:* enumerate threads (`CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD)`), `SuspendThread` all,
write, `FlushInstructionCache`, `ResumeThread`; or write only inside the documented safe window
and refuse otherwise.

**d-5 — A GUI exception falls through into the console path and misreports.**
`run()` 4889-4926: the whole GUI block is wrapped in `except Exception` which only *prints*, then
execution continues at 4928 → `require_license()` runs **again** (a second trial/quota attempt),
then 4982 `acquire_instance_lock()` fails against **our own** mutex → the app prints
`"Da co ban khac dang chay. Khong mo them."` and exits 4. A GUI crash therefore looks like
"another instance is running".
*Fix:* `return 1` (with the traceback logged) inside that `except`; never fall through after a
failed GUI start.

### MEDIUM

**d-6 — Machine binding is skipped when `hwid is None`.**
`xa_nofog_sec.py:566` `if hwid is not None:` — the one production caller passes
`st.get('hwid')` (`xa_nofog_pro.py:2258`), which is `None` if the key is absent or `null`.
`lic.bin` is DPAPI-**CurrentUser**, so a user can decrypt it, delete `"hwid"`, re-encrypt, and a
`lic.bin` copied from another machine is then accepted. Test (b) pins both behaviours:
`hwid='' → token_wrong_machine` (good), `hwid=None → ok` (hole).
*Fix:* treat `None` as `''` and give callers that genuinely need to skip binding an explicit
sentinel (`hwid=SKIP`); or make `hwid` a required argument.

**d-7 — "Nhập key / Đổi key" in the Qt GUI can never succeed.**
`xa_nofog_gui_qt.py:373-382` builds an `argparse.Namespace` and calls
`NF.require_license(ns)`, but `require_license` (4339-4350) uses `opts.get('key')` — a
`Namespace` has no `.get()` → `AttributeError` → caught at 388 → the user always sees
"Key không hợp lệ hoặc đã hết hạn". (Only reachable in the standalone build.)
*Fix:* pass the plain dict the function expects.

**d-8 — The Qt GUI writes the full licence key into a copyable log.**
`gui_qt.py:883` `self._log('Đang kích hoạt %s …' % key)` + the "Sao chép log" button (563).
Also `_ask_key` (876-879) uses an unmasked `QInputDialog`, unlike `_secure_dialog` (4151).
*Fix:* `mask_key(key)`; reuse `NF._secure_dialog()`.

**d-9 — Full HWID in a URL query.**
`gui_qt.py:770` `getf('/api/trial/left?hwid=%s' % hwid)` → HWID lands in server/proxy access logs.
*Fix:* POST body, or let the server derive it.

**d-10 — `--selftest` prints the full HWID (unmasked) and needs no licence.**
`xa_nofog_pro.py:2883` `print('      HWID = %s' % h)`, plus `PREFERRED_BASE` and `STATE_FILE`
(2850-2852). Reachable in `xa_nofog_pro.exe --selftest`; blocked only in the arena build.
*Fix:* mask it (`mask_key`) — the point of the command is build sanity, not identity.

**d-11 — `save_state()` result ignored where it matters.**
`check_online()` 1229 `save_state(st)` (no check): on a read-only/locked profile the freshly
issued token is dropped, so the tool "works now, fails next launch".
*Fix:* if it returns `False`, return `(False, 'code:state_write_failed|…')`.

**d-12 — Misleading rollback comments vs behaviour.**
`xa_update.py:999` says `.bad` is kept "de chan doan, KHONG xoa`, and the docstring at 977 says
"giữ bản lỗi thành `.bad` để chẩn đoán", but `:restored` deletes it (1012). Test (a) shows
`.bad` is gone after a successful rollback.
*Fix:* either keep `.bad` (and let `cleanup_stale` age it out) or fix both comments.

**d-13 — Spawn failure resets the anti-loop counter → 20 MB per launch.**
`apply_and_restart()` 733-742: on `_spawn_bat` failure it deletes `.new` **and**
`clear_attempts()`. If `cmd` is permanently blocked (policy/EDR) the app downloads 20 MB on
every single launch. It does **not** restart-loop (the caller returns `'error'` → tool runs),
so the visible symptom is bandwidth, not a loop.
*Fix:* do not `clear_attempts()` there; let `note_attempt` count the failed schedule.

**d-14 — `enforce_update` errors are invisible.**
`xa_nofog_pro.py:2178-2183` maps `'error'` → "just run". Combined with 4886-4887
(`except Exception: pass`) a permanently failing update is completely silent.
*Fix:* log the reason once per version into the GUI log.

**d-15 — Attempt counting has a kill window.**
`note_attempt` runs *after* `apply_and_restart` (905) but the process is killed right after
`'updating'` is returned. A kill between spawn and `note_attempt` loses the count.
*Fix:* call `note_attempt` immediately before `_spawn_bat`, and roll it back on spawn failure.

**d-16 — The attempt counter fails silently.**
`_write_update_state` (149-154) swallows write errors. Test (d) shows that with an unwritable
state dir `note_attempt` keeps returning `1` and `update_block_reason` stays `''` forever — the
anti-loop protection is inert with no signal.
*Fix:* return a bool and fall back to `%TEMP%`.

**d-17 — Dead code (module-level, verified by `_scratch/doc-nofog/deadcode.py`).**
`xa_nofog_pro.py`: `compute_weak_hwid` 678, `update_pending` 2147, `_has_runasadmin` 3151,
`_install_dir_of_exe` 3343, `_pid_wait_exit` 3483.
`xa_nofog_sec.py`: `K_INSTALL_ROOT` 119.
`xa_update.py`: `GOOD_BOOT_SEC` 81 (documented, read by nobody — only its own docstring at 964
mentions it).
Also unused imports: `base64` (`pro:89`), `QPolygonF`/`QPointF`/`QPlainTextEdit`/`QFrame`
(`gui_qt:42-48`), and unused locals `uname` (`pro:1564`), `left` (`pro:4306`), `e` (`gui_qt:223`).
`--selftest` is accepted by `parse_args` (4108) but missing from the module docstring and from
`_HELP_FALLBACK`.
*Fix:* delete, or wire up (`read_swap_result` is worth surfacing in the GUI log).

**d-18 — `--version` does not exist in this module.**
`parse_args` (4050-4131) has no `--version`/`-v` case → `'tham so khong hop le: --version'`,
exit 2. `xa_arena_app.py:738-747`, `xa_grant.py`, `xa_setup.py` all implement it. It cannot fall
through into a module (the unknown-arg branch returns before any work), but support cannot ask
"which build?" of `xa_nofog_pro.exe`.
*Fix:* add `--version` printing `CLIENT_VERSION`, before any licence/admin work.

**d-19 — `SitesUnavailable` can escape the resident loop.**
`patch()` 2768 calls `_require_sites()`, which raises. `apply_set`/the loop at 5125 do not catch
it (only `KeyboardInterrupt` at 5159). Any path that resets `SITES = None` while the loop runs
(`_load_sites` does, 2251/2260) turns into an uncaught traceback.
*Fix:* catch `SitesUnavailable` in the loop and convert it to "re-activate" messaging.

### LOW

* **d-20 — Duplicated constants.** `OFF_MANAGER = 0x3F4` appears in `pro:2722` **and**
  `tool/grant/xa_grant.py:140`; `PTR_WORLD` is a literal `0x00585E88` in `pro:2721` but
  server-supplied in grant (`grant:120,278`) — so a game update fixes grant automatically and
  leaves No-Fog silently dead (§3.3). `API_BASE` is defined independently in
  `xa_config.py:19`, `xa_nofog_pro.py:160`, `tool/grant/xa_grant_sec.py:53`,
  `tool/grant/xa_grant.py:81`, `tool/setup/xa_setup.py:69`, `README.md:29`.
  HWID derivation (`'v1|'`, `'w1|'`) is duplicated in `pro:613-623` and
  `src/lib/trial-quota.js:378-401` (values verified consistent).
  *Fix:* import from one module; move the world-pointer pair into the signed token (as grant does).
* **d-21 — `install.json` exposes a partial key** in a `Users:Modify` directory
  (`_write_install_breadcrumb` 3529-3553, `_grant_users_modify` 3326). Only `key_masked`
  (`AOE1****VIEN`) is written, never the full key. Acceptable, but note it is world-readable by
  design.
* **d-22 — Misleading MessageBox title** in `_enforce_status` (2194): `'XA THÊM TÀI NGUYÊN'`
  (the resource tool's name) while updating No-Fog.
* **d-23 — dead-but-harmless guards:** `pro:4812` `_pd_path('license.dat') if '_pd_path' in globals()`
  — `_pd_path` is always defined, and the literal bypasses `INSTALL_LICENSE_COPY`.
* **d-24 — stale documentation:** `QA-EXE-LICENSE-REPORT.md` still describes `1.4.1.0` while the
  code and `installer.js` are at `1.5.0.0`.

---

## 7. `_ask_yes_no` and the auto-install guard (asked explicitly)

`offer_install_if_needed()` 3975-4011:

```python
if not _is_frozen():            # 3979  .py runs never install
    return False
if is_installed():              # 3981  already installed -> only advice
    ...
    return False
if not _ask_yes_no('  Cai dat vao Program Files?', default=False,
                   on_no_tty=False):        # 4004-4005
    print('  Bo qua cai dat. ...')
    return False
run_install(opts)               # 4008
return True
```

`_ask_yes_no` 4541-4564 returns **`False`** whenever stdin is not a TTY (`on_no_tty=False`,
4557/4564) and `False` on any exception — the historical bug was returning `default` (`True`) in
that case. Therefore:

* `--once` **cannot** auto-install: `--once` goes through 4932-4940 →
  `offer_install_if_needed(opts)` → prompt → **no TTY ⇒ False**. (With a real TTY the customer
  must answer `y`; `default=False`, so a bare Enter is a no.)
* `--once`, `--dump`, `--off`, `--list` are handled *before* any install offer for
  `restore/dump/list` (4938) and for the rest only via the prompt above.
* Shortcuts/scheduled tasks are created **only** inside `run_install()` (3646-3673), which is
  reachable from exactly two places: an explicit `--install` (`run():4628`) or the answered
  prompt. Additionally `_TASK_XML` (3171-3211) has `<Triggers/>` — the task is on-demand only,
  so nothing is scheduled to run at logon/boot.
* `run_install` requires admin (`_need_admin_or_elevate`, 3590) and refuses game-client
  directories (`_assert_safe_target`, 3455-3480).
* **One residual asymmetry worth knowing:** the *decline* default is safe, but
  `--install` (explicit) performs no confirmation prompt — by design.

---

## 8. Verification

### 8.1 `pyflakes` (Python 3.14.6, pyflakes 4.1.0)

| File | Result |
|---|---|
| `tool/src/xa_nofog_pro.py` | 3: `89:1 'base64' imported but unused`; `1564:5 local variable 'uname' is assigned to but never used`; `4306:9 local variable 'left' is assigned to but never used` |
| `tool/src/xa_nofog_sec.py` | **clean** (exit 0) |
| `tool/src/xa_nofog_gui_qt.py` | 5: `42 QPolygonF`, `45 QPointF`, `46 QPlainTextEdit`, `46 QFrame` unused imports; `223:17 local variable 'e' … never used` |
| `tool/src/xa_config.py` | **clean** |
| `tool/src/xa_nofog_const.py` | **clean** |
| `tool/ui/xa_update.py` | **clean** |

### 8.2 `ast.parse`

All six parse successfully (byte-level, UTF-8): `xa_nofog_pro` (195107 B, 158 funcs, 6 classes,
299 top-level nodes), `xa_nofog_sec` (22803 B, 28 funcs, 2 classes), `xa_nofog_gui_qt` (34173 B,
39 funcs, 5 classes), `xa_config` (4269 B), `xa_nofog_const` (1110 B), `xa_update` (39005 B,
37 funcs). No syntax errors, no `SyntaxWarning`.

### 8.3 `_scratch/doc-nofog/test_nofog_doc.py` — 44 checks, 0 failures

```
=== (a) rollback_now() — khong de may mat EXE ===
  [PASS] rollback_now() tra True khi co .old hop le
  [PASS] khong co `del <exe>` trong script rollback
  [PASS] script co buoc doi ten EXE -> .bad (move, khong phai del)
  [PASS] script co buoc dua .old ve lai dung cho
  [PASS] script co duong lui: tra .bad ve cho neu buoc 2 that bai
  [PASS] SAU rollback: EXE van ton tai
  [PASS] SAU rollback: EXE = BAN CU (da quay lui)  -- sha=830492d76d75
  [PASS] SAU rollback: .bad da bi xoa (nhanh :restored)
  [PASS] SAU rollback: swap_result.txt ghi "rollback"
  [PASS] khong co .old -> rollback_now() tu choi (False)
  [PASS] khong co .old -> KHONG sinh .bat nao
  [PASS] khong co .old -> EXE nguyen ven
  [PASS] .old == EXE -> tu choi
  [PASS] .old == EXE -> KHONG sinh .bat
  [PASS] .old == EXE -> EXE nguyen ven
=== (a2) apply_and_restart() — script thay file ===
  [PASS] apply_and_restart() tra True
  [PASS] SAU thay file: EXE = ban moi
  [PASS] SAU thay file: .old = ban cu
  [PASS] SAU thay file: .new da bien mat
  [PASS] thieu .new: EXE van con va la ban cu
  [PASS] thieu .new: khong tao .old rac
  [PASS] _write_bat dung UTF-8 CO BOM  -- efbbbf
  [PASS] rollback chay dung trong thu muc co dau tieng Viet  -- rc=1
=== (b) token binding khi HWID rong ===
  [PASS] verify_token_local('') -> ok=False, code=no_token
  [PASS] token sai dinh dang -> tu choi
  [PASS] chu ky sai -> tu choi (bad_sig)
  [PASS] bind_token_to_machine(hwid="") -> TU CHOI (fail closed)
  [PASS] bind_token_to_machine(hwid=None) -> BO QUA kiem may (lo hong con lai)
  [PASS] bind_token_to_machine(hwid="maykhac") -> tu choi
  [PASS] bind_token_to_machine(hwid dung) -> cho qua
  [PASS] token khong co 'h' -> cho qua (chu y: KHONG bind gi)
  [PASS] token het han -> tu choi
=== (c) cleanup_stale() — .old con sot ===
  [PASS] truoc: .old co ton tai
  [PASS] cleanup_stale() xoa .old khi EXE da la ban moi  -- removed=1
  [PASS] EXE dang chay KHONG bi dung toi
  [PASS] .new cu > 24h bi xoa
  [PASS] .new.part bi xoa
=== (d) chong lap: note_attempt / update_block_reason ===
  [PASS] ban dau: chua bi chan
  [PASS] lan thu 1: attempts=1 (MAX=2)
  [PASS] lan thu 2: attempts=2 va BI CHAN (cooldown)  -- attempts=2 reason='đã thử 2 lần cho bản 1.5.0.0'
  [PASS] phien ban server MOI hon -> duoc thu lai ngay
  [PASS] clear_attempts() -> bo chan
  [PASS] khong ghi duoc state -> bo dem KHONG tang va KHONG chan (im lang)
=== (e) on_start(): xa_nofog_pro goi THIEU exe_path ===
  [PASS] on_start(app_name) khong co exe_path -> luon (0, False)  -- tra ve (0, False)
==============================================================
PASS: 44   FAIL: 0
```

Method notes (so the evidence is not over-read):
* The test never lets the product spawn `cmd` (`_spawn_bat` is stubbed) and never lets `start`
  run (`start` lines are commented out before execution). It then executes the **real** rendered
  script text, so the file-state assertions are genuine.
* `state_dir()` is redirected into the temp dir, so nothing is written to the real
  `%LOCALAPPDATA%`.
* Every script exits `1` because `del "%~f0"` makes cmd lose the file; that is expected and is
  why `swap_result.txt` (not the exit code) is the real signal.

---

## 9. Every file the No-Fog side writes

| Path | Written by | Contents | Secret? |
|---|---|---|---|
| `%LOCALAPPDATA%\XArenaNoFog\lic.bin` | `save_state` 716 | `XANF` + DPAPI(JSON): key, hwid, **signed licence token**, `expires_at`, plan, quota, **account session cookie** | **YES** (key + cookie + token). DPAPI CurrentUser, hidden attr |
| `…\XArenaNoFog\lic.bin.tmp` | `save_state` | same, transient | YES |
| `…\XArenaNoFog\ts` | `_anchor_write` 1901 | `salt + ascii(ts) + SHA256(salt‖ts)` anti-rollback anchor | no |
| `%PROGRAMDATA%\XArenaNoFog\run.lock` | `_write_lock_pid` 2400 | PID text (single-instance) | no |
| `…\XArenaNoFog\run.lock.tmp` | same | transient | no |
| `…\XArenaNoFog\.w` | `_lock_file` 2350 | 1 byte write-probe, deleted at once | no |
| `…\XArenaNoFog\install.json` | `_write_install_breadcrumb` 3529 | `{v, had_paid, key_masked, at, ver}` | partial key (`AOE1****VIEN`) |
| `…\XArenaNoFog\license.dat` | `_copy_license_to_programdata` 3556 | byte copy of `lic.bin`, ACL → Administrators+SYSTEM only | **YES** |
| `%LOCALAPPDATA%\XArenaNoFog\run.lock` | `_lock_file` fallback | PID (per-user fallback) | no |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\XASupport\LastRun` | `_reg_anchor_write` 1928 | REG_SZ epoch | no |
| `HKCU\…\AppCompatFlags\Layers\<install exe>` | `_set_runasadmin` 3123 | `~ RUNASADMIN` | no |
| `%ProgramFiles%\<vendor>\_re\chayduoc\xa_nofog_pro.exe` (+`.new`) | `run_install` 3633 | the EXE | – |
| Desktop + Public Desktop `XARENA MAP SÁNG.lnk` | `_make_shortcut` 3082 | shortcut (via `cscript` + temp `.vbs` in `%TEMP%`, deleted) | no |
| Scheduled Task `XARENA MAP SÁNG` | `_create_elevated_task` 3264 | via `schtasks /Create /XML` (UTF-16 temp file, deleted); **no triggers** | no |
| `%TEMP%\_xanf_lnk_<pid>.vbs`, `_xanf_task_<pid>.xml`, `_xanf_old_<pid>.exe` | shortcut/task/uninstall | transient; the parked exe is `MoveFileEx(DELAY_UNTIL_REBOOT)` | no |
| `<exe>.new`, `<exe>.new.part`, `<exe>.old`, `<exe>.bad` | `download`/`_swap_lines`/`rollback_now` | downloaded build / previous build | – |
| `%LOCALAPPDATA%\<app>\update_state.json` | `_write_update_state` 149 | `version, attempts, blocked_until, applied_sha, applied_size, applied_version` | no |
| `%LOCALAPPDATA%\<app>\boot_count` | `_write_boot` 127 | `{count, pid}` | no |
| `%LOCALAPPDATA%\<app>\swap_result.txt` | the `.bat` | `ok` / `fail-…` / `rollback…` | no |
| `%TEMP%\xa_update_<pid>.bat`, `xa_rollback_<pid>.bat` | `_bat_path` 611 | the scripts in §5.2/§5.4 (UTF-8+BOM, CRLF), self-deleted | paths only |

`%LOCALAPPDATA%\<app>` is `XAArena` for `apply_and_restart`/`enforce_update` and
`XArenaNoFog` for `on_start`/`mark_good` — see d-2.

---

## 10. Constants

### 10.1 Version strings — cross-checked

| Constant | File:line | Value | Must match | Verified |
|---|---|---|---|---|
| `CLIENT_VERSION` | `xa_nofog_pro.py:218` | `1.5.0.0` | `EXE_VERSION` in `src/routes/installer.js:50` = `1.5.0.0` | **MATCH** |
| `APP_VERSION` | `tool/app/xa_arena_app.py:50` | `2.3.7.0` | `EXE_VERSION` in `src/routes/arena-installer.js:31` = `2.3.7.0` | **MATCH** |
| `APP_VERSION` | `tool/grant/xa_grant.py:100` | `1.0.3.0` | `src/routes/xa-grant-installer.js:28` = `1.0.3.0` | **MATCH** |
| `installer.js:47-48` | | `sha256 9981FAEC…C097`, `size 9105408` | must equal the built EXE | not verified here (no build performed) |

No-Fog (`1.5.0.0`) and Arena (`2.3.7.0`) are **separate products** — the two numbers are
*intentionally* different; the pairing that must hold is No-Fog↔`installer.js` and
Arena↔`arena-installer.js`. Both hold.

### 10.2 `xa_nofog_pro.py`

| Name | Value | Meaning |
|---|---|---|
| `LICENSE_MODE` | `'server'` | fixed label printed by `--status` |
| `API_BASE` | `NF.C(K_API_BASE)`/env/`xa_config`, `rstrip('/')` | licence server (`https://xienhl.com`) |
| `APP_NAME` | `XARENA MAP SÁNG` (blob / `xa_config`) | UA + window title |
| `TERMS` | `{'TUAN':7,'THANG':30,'NAM':365,'VINHVIEN':0}` | reference only (server decides) |
| `PROCESS_NAMES` | `EMPIRESX.EXE, EMPIRESX_HD.EXE, EMPIRESX_HDR.EXE` | game EXEs |
| `PREFERRED_BASE` | `0x400000` | assumed image base (ASLR off) |
| `RESIDENT_POLL` | `2.0` | poll seconds |
| `HTTP_TIMEOUT` | `10` | network timeout |
| `EXIT_NOT_ADMIN` | `5` | exit code |
| `EXIT_NO_LICENSE` | `3` | exit code |
| `EXIT_ALREADY_RUNNING` | `4` | exit code |
| `EXIT_TRIAL_END` | `6` | exit code |
| `EXIT_TRIAL_QUOTA` | `7` | exit code (trial quota exhausted) |
| `EXIT_OUTDATED` | `8` | exit code (client too old) |
| `MUTEX_NAME` | `Global\XArenaNoFogPro` | single-instance mutex (+`XArenaNoFogPro_Local` fallback) |
| `ERROR_ALREADY_EXISTS` | `183` | Win32 |
| `CLOCK_SKEW_TOLERANCE` | `7200` | s; rollback/forward tolerance before "tampered" |
| `REG_KEY` | `Software\Microsoft\Windows\CurrentVersion\XASupport` | HKCU anchor |
| `TRIAL_ENABLED` | `True` | master switch |
| `TRIAL_REQUIRE_ACCOUNT` | `True` | **declared, never read** |
| `TRIAL_1H_MINUTES/LIMIT/RECHECK` | `60 / 10 / 120` | 1-hour trial |
| `TRIAL_3D_DAYS/LIMIT/RECHECK` | `3 / 10 / 900` | 3-day trial |
| `TRIAL_DEFAULT_KIND` | `'3d'` | no-arg default |
| `TRIAL_WARN_SEC_1H` | `600` | warn at 10 min left |
| `TRIAL_WARN_DAYS_3D` | `1` | warn at 1 day left |
| `TRIAL_DAYS` / `TRIAL_WARN_DAYS` | `3` / `1` | back-compat aliases |
| `TRIAL_GRACE_HOURS` | `0` | **declared, never read** (`_grace_left` short-circuits) |
| `TRIAL_RECHECK_SEC` | `300` | resident re-check period |
| `BUY_URL` | `https://xienhl.com/#/product/license-xarena-thang` | shop |
| `LOGIN_URL` / `REGISTER_URL` / `FORGOT_URL` | `…/#/login`, `…/#/register`(blob), `…/#/login` | web |
| `CLIENT_VERSION` | `1.5.0.0` | **must match `installer.js`** |
| `TRIAL_KINDS` | `{'1h':{label,sec,recheck}, '3d':{…}}` | trial table |
| `REQUIRE_ONLINE` | `True` | no offline grace at all |
| `STATE_DIR` / `STATE_FILE` | `%LOCALAPPDATA%\XArenaNoFog` / `…\lic.bin` | state |
| `_INSTALL_VENDOR` | `XArenaNoFog` (env `XA_INSTALL_ROOT_NAME`) | install dir name |
| `INSTALL_ROOT` / `INSTALL_EXE_DIR` / `INSTALL_EXE` | `%ProgramFiles%\<vendor>` / `…\_re\chayduoc` / `…\xa_nofog_pro.exe` | install |
| `INSTALL_JSON` / `INSTALL_LICENSE_COPY` | `install.json` / `license.dat` | breadcrumb / backup |
| `INSTALL_OWNED` | `('_re','install.json')` | "this folder is ours" markers |
| `SHORTCUT_NAME` / `TASK_NAME` | `XARENA MAP SÁNG.lnk` / `XARENA MAP SÁNG` | shortcut / task |
| `DOWNLOAD_URL` | `https://xienhl.com/tai-ve` | shown when outdated |
| `RUNAS_VALUE` / `LAYERS_KEY` | `~ RUNASADMIN` / `…\AppCompatFlags\Layers` | UAC |
| `_HWID_MIN_PARTS` | `2` | minimum hardware parts (fail-closed gate) |
| `ACCESS` | `0x438` | `PROCESS_VM_{OPERATION,WRITE,READ}`+`QUERY_INFORMATION` |
| `SYNC` | `0x00100000` | `SYNCHRONIZE` |
| `TH32CS_SNAPPROCESS` | `2` | Toolhelp32 |
| `PAGE_EXECUTE_READWRITE` | `0x40` | `VirtualProtectEx` |
| `MAX_PATH` | `260` | `PROCESSENTRY32` |
| `INVALID_HANDLE_VALUE` | `-1` as void* | snapshot check |
| `SW_SHOWNORMAL` | `1` | `ShellExecuteW` |
| `TOKEN_QUERY` / `TokenElevation` | `8` / `20` | `is_admin()` |
| `PTR_WORLD` | `0x00585E88` | in-match detection (hard-coded!) |
| `OFF_MANAGER` | `0x3F4` | `[world+0x3F4]` |
| `LOCK_DIR` / `_LOCK_FILE` / `_LOCK_FILE_LEGACY` | `%PROGRAMDATA%\XArenaNoFog` / `run.lock` / per-user | instance lock |
| `GAME_CLIENT_MARKERS` / `GAME_CLIENT_DIRS` | 10 names / 7 dirs | "don't touch the game" guard |
| `_SHORTCUT_VBS`, `_TASK_XML` | templates | shortcut / scheduled task |
| `_HELP_FALLBACK` | help text | used when `__doc__` is stripped |

### 10.3 `xa_nofog_sec.py`

| Name | Value | Meaning |
|---|---|---|
| `_SALT_A` / `_SALT_B` | `b'XN\|5d1c'` / `b'9b27\|fQ'` | XOR key material (split) |
| `_P,_A,_N,_GX,_GY,_B_COEF` | NIST P-256 params | ECDSA verify |
| `K_PUB_X…K_INSTALL_ROOT` | `1…12` | constant indices |
| `_VA_MIN`/`_VA_MAX` | `0x400000` / `0x08000000` | legal gate address window |
| `_RUN_MIN`/`_RUN_MAX` | `1` / `16` | legal gate byte-run length |
| `SiteTable.GROUPS` | `('viewport','minimap','legacy')` | must match server `GROUPS` |
| `_TOKEN_ERRORS` | 8 codes | user-facing messages |

### 10.4 `xa_config.py` / `xa_nofog_const.py`

`xa_config.py`: `API_BASE`, `APP_NAME`, `PROCESS_NAMES`, `PREFERRED_BASE 0x400000`,
`RESIDENT_POLL 2.0`, `TERMS`, `CLOCK_SKEW_TOLERANCE 7200`, `STATE_SUBDIR 'XArenaNoFog'`,
`REG_KEY`, `MUTEX_NAME`, `HTTP_TIMEOUT 10`, `EXIT_* 5/3/4/6`, `TRIAL_*`, `BUY_URL`,
`LOGIN_URL`, `REQUIRE_ONLINE True`.
`xa_nofog_const.py`: `BLOBS` 1–12 (12 XOR blobs; plaintexts recovered at runtime by
`xa_nofog_sec.C()`: public key X/Y, API base, app name, UA, mutex, reg key, anchor salt,
process names, buy/register URLs, install root name).

### 10.5 `xa_update.py`

| Name | Value | Meaning |
|---|---|---|
| `ALLOWED_HOSTS` | `('xienhl.com','www.xienhl.com')` | download allow-list |
| `DL_TIMEOUT` | `300` | download timeout (s) |
| `MAX_BAD_BOOTS` | `2` | rollback threshold (`>2`) |
| `GOOD_BOOT_SEC` | `60` | documented; **read by nobody** |
| `DEFAULT_APP` | `'XAArena'` | state dir name (see d-2) |
| `MAX_APPLY_TRIES` | `2` | attempts before cooldown |
| `RETRY_COOLDOWN_SEC` | `21600` | 6 h |
| `BAT_MOVE_RETRIES` | `30` | `.bat` rename retries (~30 s) |

---

## 11. Chưa xác minh (explicitly not verified)

* That the shipped `xa_nofog_pro.exe` on R2 has `sha256 9981FAEC…C097` / `9 105 408` bytes, and
  that it was built from **this** source (no build, no download performed).
* Real hard-ware behaviour of `compute_hwid()` / `_bios_serial()` on actual customer machines
  (only the code path was audited; the fail-closed guard was exercised with synthetic parts).
* Server-side (`src/routes/license-server.js`, `trial.js`, `trial-quota.js`) behaviour beyond the
  two facts cited in §10.1 and §6 d-20; no server was run.
* Whether any *released* build is reachable whose `--list`/`--dump` are already blocked.
* Behaviour of `VirtualProtectEx`/`WriteProcessMemory` under a real anti-cheat in a live match
  (no game was launched; no patch was executed against a real process).
* That `cmd.exe` honours the UTF-8 BOM on every Windows build — it was measured here on Windows
  11 (including a directory named `Nguyễn Văn A`), not on Windows 7/8/10.
