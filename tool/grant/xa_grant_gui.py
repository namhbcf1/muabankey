# -*- coding: utf-8 -*-
"""xa_grant_gui.py -- GUI cho XA GRANT.

Bam nut de cong tai nguyen, khong can go lenh.

Thiet ke:
  * Moi nut = 1 lenh grant cho CA BON loai tai nguyen (thit/go/da/vang).
  * Bam nhieu lan duoc -- moi lan cong them.
  * Khong doi hoi go phim; chi can game dang chay + da vao tran.
  * Hop thoai xac nhan truoc khi cong so lon (>= 10000) de tranh bam nham.
"""
import os
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk

# Import engine tu file chinh
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    import xa_grant as XG
except Exception as _e:  # pragma: no cover
    import traceback
    traceback.print_exc()
    print('\nKhong nap duoc xa_grant: %s' % _e)
    input('Enter de thoat...')
    sys.exit(1)


# ======================================================================
# CAU HINH NUT
# ======================================================================
# (nhan, so luong, mo ta, mau)
BUTTONS = [
    ('+1.000', 1000, 'Thịt · Gỗ · Đá · Vàng', '#2563eb'),
    ('+5.000', 5000, 'Thịt · Gỗ · Đá · Vàng', '#7c3aed'),
    ('+10.000', 10000, 'Thịt · Gỗ · Đá · Vàng', '#db2777'),
    ('+50.000', 50000, 'Thịt · Gỗ · Đá · Vàng', '#ea580c'),
    ('+100.000', 100000, 'Thịt · Gỗ · Đá · Vàng', '#dc2626'),
]

RES_ORDER = ['F', 'W', 'S', 'G']          # thit, go, da, vang
RES_VN = {'F': 'thịt', 'W': 'gỗ', 'S': 'đá', 'G': 'vàng'}

BG = '#0b1220'
CARD = '#151f33'
FG = '#e8eef8'
MUTE = '#8fa3c0'
OK = '#22c55e'
ERR = '#ef4444'


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('XA GRANT — Thêm tài nguyên')
        self.configure(bg=BG)
        self.geometry('620x680')
        self.minsize(560, 620)
        self.resizable(True, True)

        self.h = None
        self.pid = None
        self.base = None
        self.busy = False

        self._build()
        self.after(300, self._boot)

    # ------------------------------------------------------------------
    # GIAO DIEN
    # ------------------------------------------------------------------
    def _build(self):
        # --- Tieu de ---
        head = tk.Frame(self, bg=BG)
        head.pack(fill='x', padx=24, pady=(22, 8))

        tk.Label(head, text='THÊM TÀI NGUYÊN', bg=BG, fg=FG,
                 font=('Segoe UI', 20, 'bold')).pack(anchor='w')
        tk.Label(head, text='AoE XArena · bấm nút để cộng', bg=BG, fg=MUTE,
                 font=('Segoe UI', 10)).pack(anchor='w', pady=(2, 0))

        # --- Trang thai ---
        st = tk.Frame(self, bg=CARD)
        st.pack(fill='x', padx=24, pady=(14, 12))

        self.lbl_state = tk.Label(st, text='● Đang kiểm tra…', bg=CARD, fg=MUTE,
                                  font=('Segoe UI', 11, 'bold'), anchor='w')
        self.lbl_state.pack(fill='x', padx=14, pady=(10, 2))

        self.lbl_detail = tk.Label(st, text='', bg=CARD, fg=MUTE,
                                   font=('Segoe UI', 9), anchor='w',
                                   justify='left', wraplength=540)
        self.lbl_detail.pack(fill='x', padx=14, pady=(0, 10))

        # --- Nut bam ---
        grid = tk.Frame(self, bg=BG)
        grid.pack(fill='both', expand=True, padx=24, pady=(0, 8))

        self.btn_refs = []
        for i, (lbl, amt, desc, color) in enumerate(BUTTONS):
            b = tk.Button(
                grid, text='%s\n%s' % (lbl, desc),
                bg=color, fg='#ffffff',
                activebackground=color, activeforeground='#ffffff',
                font=('Segoe UI', 12, 'bold'),
                relief='flat', bd=0, cursor='hand2',
                command=lambda a=amt: self._grant(a),
            )
            r, c = divmod(i, 2)
            b.grid(row=r, column=c, sticky='nsew', padx=(0 if c == 0 else 7, 7 if c == 0 else 0),
                   pady=(0, 8), ipady=14)
            self.btn_refs.append(b)

        # Nut cuoi chiem ca 2 cot
        lbl, amt, desc, color = BUTTONS[-1]
        last = self.btn_refs[-1]
        last.grid_configure(row=2, column=0, columnspan=2,
                            padx=0, pady=(0, 10), ipady=16)

        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

        # --- Tuy chinh ---
        cus = tk.Frame(self, bg=CARD)
        cus.pack(fill='x', padx=24, pady=(0, 12))

        tk.Label(cus, text='Số lượng khác', bg=CARD, fg=MUTE,
                 font=('Segoe UI', 9)).pack(anchor='w', padx=14, pady=(10, 4))

        row = tk.Frame(cus, bg=CARD)
        row.pack(fill='x', padx=14, pady=(0, 12))

        self.ent = tk.Entry(row, bg='#0e1729', fg=FG, insertbackground=FG,
                            relief='flat', font=('Segoe UI', 12), width=12)
        self.ent.pack(side='left', ipady=6, padx=(0, 8))
        self.ent.bind('<Return>', lambda e: self._grant_custom())

        tk.Button(row, text='Cộng', bg='#334155', fg=FG,
                  activebackground='#475569', activeforeground=FG,
                  relief='flat', bd=0, cursor='hand2',
                  font=('Segoe UI', 10, 'bold'),
                  command=self._grant_custom).pack(side='left', ipady=6, ipadx=18)

        # --- Log ---
        logf = tk.Frame(self, bg=BG)
        logf.pack(fill='both', expand=True, padx=24, pady=(0, 6))

        self.log = tk.Text(logf, bg='#080d16', fg=MUTE, relief='flat',
                           font=('Consolas', 9), height=6, wrap='word',
                           state='disabled', padx=10, pady=8)
        self.log.pack(fill='both', expand=True)

        # --- Footer ---
        foot = tk.Frame(self, bg=BG)
        foot.pack(fill='x', padx=24, pady=(0, 16))

        tk.Button(foot, text='Kiểm tra tài nguyên', bg='#1e293b', fg=FG,
                  activebackground='#334155', activeforeground=FG,
                  relief='flat', bd=0, cursor='hand2',
                  font=('Segoe UI', 10),
                  command=self._check).pack(side='left', ipady=6, ipadx=14)

        self.btn_key = tk.Button(foot, text='🔑 Nhập key', bg='#2563eb', fg='#fff',
                                 activebackground='#1d4ed8', activeforeground='#fff',
                                 relief='flat', bd=0, cursor='hand2',
                                 font=('Segoe UI', 10, 'bold'),
                                 command=self._ask_key)

        tk.Button(foot, text='Đóng', bg='#1e293b', fg=FG,
                  activebackground='#334155', activeforeground=FG,
                  relief='flat', bd=0, cursor='hand2',
                  font=('Segoe UI', 10),
                  command=self.destroy).pack(side='right', ipady=6, ipadx=18)

    # ------------------------------------------------------------------
    # TIEN ICH
    # ------------------------------------------------------------------
    def _say(self, text, color=None):
        self.log.configure(state='normal')
        self.log.insert('end', text + '\n')
        self.log.see('end')
        self.log.configure(state='disabled')

    def _state(self, text, color, detail=''):
        self.lbl_state.configure(text=text, fg=color)
        self.lbl_detail.configure(text=detail)

    def _set_busy(self, on):
        self.busy = on
        for b in self.btn_refs:
            b.configure(state='disabled' if on else 'normal')
        self.configure(cursor='watch' if on else '')

    def _bg(self, fn, *a):
        """Chay fn trong thread de GUI khong dung."""
        def run():
            try:
                fn(*a)
            except Exception as e:
                self.after(0, lambda: self._say('Lỗi: %s: %s' % (type(e).__name__, e)))
            finally:
                self.after(0, lambda: self._set_busy(False))
        self._set_busy(True)
        threading.Thread(target=run, daemon=True).start()

    # ------------------------------------------------------------------
    # KHOI DONG
    # ------------------------------------------------------------------
    def _boot(self):
        def work():
            # 1. Token
            ok, msg = XG.ensure_engine()
            if not ok:
                self.after(0, lambda: self._state('● Chưa kích hoạt', ERR, msg))
                self.after(0, lambda: self._say('[!] ' + msg.replace('\n', ' ')))
                # Hien nut kich hoạt
                self.after(0, lambda: self.btn_key.pack(side='left', ipady=6, ipadx=14))
                return
            self.after(0, lambda: self.btn_key.pack_forget())

            key = XG._ENGINE_LOADED.get('key') or '?'
            exp = XG._ENGINE_LOADED.get('exp') or 0
            import time as _t
            han = 'vĩnh viễn' if not exp else _t.strftime('%d/%m/%Y', _t.localtime(exp))
            self.after(0, lambda: self._say('[ok] Key %s — hạn %s' % (key, han)))

            # 2. Admin
            if not XG.is_admin():
                self.after(0, lambda: self._state(
                    '● Cần quyền Administrator', ERR,
                    'Chuột phải xa_grant.exe → Run as administrator'))
                return

            # 3. Game
            procs = XG.find_game()
            if not procs:
                self.after(0, lambda: self._state(
                    '● Chưa thấy game', ERR,
                    'Mở EMPIRESX.EXE và vào trận trước, rồi bấm Kiểm tra.'))
                return

            pid, name = procs[0]
            self.pid = pid
            h = XG.open_game(pid)
            self.h = h
            base = XG.module_base(h)
            self.base = base

            if base != XG.PREFERRED_BASE:
                self.after(0, lambda: self._state(
                    '● Sai phiên bản game', ERR,
                    'base = 0x%08X (cần 0x%08X)' % (base, XG.PREFERRED_BASE)))
                return

            XG.verify_build(h, base)

            # 4. Vao tran chua
            world = XG.u32(h, XG.PTR_WORLD)
            if not world:
                self.after(0, lambda: self._state(
                    '● Chưa vào trận', ERR,
                    '%s pid %d — hãy vào trận thật rồi bấm Kiểm tra.' % (name, pid)))
                return

            n = XG.my_number(h)
            self.after(0, lambda: self._state(
                '● Sẵn sàng', OK,
                '%s pid %d · base 0x%08X · bạn là người số %s'
                % (name, pid, base, n if n else '?')))
            self.after(0, lambda: self._say('[ok] Đã kết nối game, sẵn sàng cộng.'))

        self._bg(work)

    # ------------------------------------------------------------------
    # KICH HOAT KEY
    # ------------------------------------------------------------------
    def _ask_key(self):
        """Hop thoai nhap key khi chua kich hoat."""
        top = tk.Toplevel(self)
        top.title('Kích hoạt')
        top.configure(bg=BG)
        top.geometry('520x260')
        top.resizable(False, False)
        top.transient(self)
        top.grab_set()

        tk.Label(top, text='Nhập key bản quyền', bg=BG, fg=FG,
                 font=('Segoe UI', 13, 'bold')).pack(anchor='w', padx=22, pady=(20, 4))
        tk.Label(top, text='Key dạng XAGR-XXXX-XXXX-XXXX', bg=BG, fg=MUTE,
                 font=('Segoe UI', 9)).pack(anchor='w', padx=22, pady=(0, 12))

        e = tk.Entry(top, bg='#0e1729', fg=FG, insertbackground=FG,
                     relief='flat', font=('Consolas', 13))
        e.pack(fill='x', padx=22, ipady=8)
        e.focus_set()

        msg = tk.Label(top, text='', bg=BG, fg=ERR, font=('Segoe UI', 9),
                       wraplength=470, justify='left')
        msg.pack(anchor='w', padx=22, pady=(10, 0))

        def submit():
            k = e.get().strip().upper()
            if not k:
                msg.configure(text='Chưa nhập key.')
                return
            msg.configure(text='Đang kích hoạt…', fg=MUTE)
            top.update()

            def work():
                try:
                    r = XG.activate_key(k)
                    if r.get('ok'):
                        self.after(0, top.destroy)
                        self.after(0, lambda: self._say('[ok] Đã kích hoạt %s' % k))
                        self.after(0, self._boot)
                    else:
                        t = r.get('msg') or r.get('code') or 'Key không hợp lệ'
                        self.after(0, lambda: msg.configure(text=str(t)[:200], fg=ERR))
                except Exception as ex:
                    self.after(0, lambda: msg.configure(
                        text='%s: %s' % (type(ex).__name__, ex), fg=ERR))

            threading.Thread(target=work, daemon=True).start()

        e.bind('<Return>', lambda ev: submit())

        row = tk.Frame(top, bg=BG)
        row.pack(fill='x', padx=22, pady=(14, 0))
        tk.Button(row, text='Kích hoạt', bg='#2563eb', fg='#fff',
                  activebackground='#1d4ed8', activeforeground='#fff',
                  relief='flat', bd=0, cursor='hand2',
                  font=('Segoe UI', 10, 'bold'),
                  command=submit).pack(side='left', ipady=7, ipadx=22)
        tk.Button(row, text='Đóng', bg='#1e293b', fg=FG,
                  activebackground='#334155', activeforeground=FG,
                  relief='flat', bd=0, cursor='hand2',
                  font=('Segoe UI', 10),
                  command=top.destroy).pack(side='right', ipady=7, ipadx=18)

    # ------------------------------------------------------------------
    # CONG TAI NGUYEN
    # ------------------------------------------------------------------
    def _grant(self, amount):
        if self.busy:
            return
        if amount >= 10000:
            if not messagebox.askyesno(
                    'Xác nhận',
                    'Cộng %s mỗi loại?\n\nThịt · Gỗ · Đá · Vàng' % f'{amount:,}'.replace(',', '.'),
                    parent=self):
                return
        self._do(amount)

    def _grant_custom(self):
        if self.busy:
            return
        raw = self.ent.get().strip().replace('.', '').replace(',', '').replace(' ', '')
        if not raw.isdigit():
            self._say('[!] Số không hợp lệ: %r' % self.ent.get())
            return
        n = int(raw)
        if n <= 0 or n > 10_000_000:
            self._say('[!] Số phải từ 1 đến 10.000.000')
            return
        if n >= 10000:
            if not messagebox.askyesno(
                    'Xác nhận',
                    'Cộng %s mỗi loại?\n\nThịt · Gỗ · Đá · Vàng' % f'{n:,}'.replace(',', '.'),
                    parent=self):
                return
        self._do(n)

    def _do(self, amount):
        def work():
            # Mo lai game neu can (khach co the da tat game)
            if self.h is None or not self._alive():
                self.after(0, lambda: self._say('… mở lại game'))
                if not self._reopen():
                    self.after(0, lambda: self._state(
                        '● Mất kết nối game', ERR,
                        'Game đã tắt. Mở lại và vào trận, rồi bấm Kiểm tra.'))
                    return

            label = f'{amount:,}'.replace(',', '.')
            self.after(0, lambda: self._say('→ Đang cộng %s mỗi loại…' % label))

            okn = 0
            for r in RES_ORDER:
                try:
                    XG.do_grant(self.h, self.base, r, amount, False, True, None)
                    okn += 1
                    self.after(0, lambda rr=r: self._say('   ✓ %s' % RES_VN[rr]))
                except XG.GrantError as e:
                    self.after(0, lambda rr=r, ee=e: self._say(
                        '   ✗ %s: %s' % (RES_VN[rr], str(ee).split(chr(10))[0])))
                except Exception as e:
                    self.after(0, lambda rr=r, ee=e: self._say(
                        '   ✗ %s: %s: %s' % (RES_VN[rr], type(ee).__name__, ee)))

            if okn == 4:
                self.after(0, lambda: self._state(
                    '● Đã cộng %s mỗi loại' % label, OK,
                    'Thịt · Gỗ · Đá · Vàng'))
                self.after(0, lambda: self._say('[ok] Xong: +%s × 4 loại' % label))
            elif okn:
                self.after(0, lambda: self._state(
                    '● Cộng được %d/4 loại' % okn, '#f59e0b', 'Xem log bên dưới'))
            else:
                self.after(0, lambda: self._state(
                    '● Không cộng được', ERR, 'Xem log bên dưới để biết lý do'))

        self._bg(work)

    def _alive(self):
        try:
            if not self.h:
                return False
            code = XG.k32.WaitForSingleObject(self.h, 0)
            return code == 0x102  # WAIT_TIMEOUT = con song
        except Exception:
            return False

    def _reopen(self):
        try:
            procs = XG.find_game()
            if not procs:
                return False
            pid, _ = procs[0]
            h = XG.open_game(pid)
            base = XG.module_base(h)
            if base != XG.PREFERRED_BASE:
                return False
            XG.verify_build(h, base)
            if not XG.u32(h, XG.PTR_WORLD):
                return False
            self.h, self.base, self.pid = h, base, pid
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # KIEM TRA
    # ------------------------------------------------------------------
    def _check(self):
        if self.busy:
            return

        def work():
            if not self._alive():
                self.after(0, lambda: self._say('… mở lại game'))
                if not self._reopen():
                    self.after(0, lambda: self._state(
                        '● Chưa thấy game', ERR,
                        'Mở EMPIRESX.EXE và vào trận, rồi bấm Kiểm tra lại.'))
                    return

            try:
                players = XG.list_players(self.h)
            except Exception as e:
                self.after(0, lambda: self._say('[!] %s' % e))
                return

            lv = XG.local_index(self.h)
            me = None
            for p in players or []:
                if p.get('idx') == lv:
                    me = p
                    break

            if not me:
                self.after(0, lambda: self._state(
                    '● Không đọc được người chơi', ERR,
                    'Hãy chắc đã vào trận thật (không phải menu).'))
                return

            v = me.get('vals') or {}
            txt = 'Thịt %s · Gỗ %s · Đá %s · Vàng %s' % (
                f"{int(v.get('F', 0)):,}".replace(',', '.'),
                f"{int(v.get('W', 0)):,}".replace(',', '.'),
                f"{int(v.get('S', 0)):,}".replace(',', '.'),
                f"{int(v.get('G', 0)):,}".replace(',', '.'),
            )
            self.after(0, lambda: self._state('● Sẵn sàng', OK, txt))
            self.after(0, lambda: self._say('Hiện có: ' + txt))

        self._bg(work)


def main():
    app = App()
    try:
        app.mainloop()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
