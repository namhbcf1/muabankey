# -*- coding: utf-8 -*-
"""xa_grant_plan.py — LẬP KẾ HOẠC CỘNG TÀI NGUYÊN (thuần logic).

VÌ SAO CÓ FILE NÀY
==================
`GrantWorker.run` trước đây chứa 150 dòng về "chia số lớn thành các bước"
trộn lẫn với việc gọi engine. Hệ quả:

  - Không test được mà không có game đang chạy (không thể gọi `do_grant`).
  - Lỗi "cộng 10.000 ở phút 1 = 1.000 bước = 5 phút" bị bỏ sót vì
    không cách nào kiểm tra logic lập kế hoạch độc lập.

Nay quy tắc nằm RIÊNG ở đây:

    plan = GrantPlan(total_by_res, mins, fast)
    steps = plan.steps()      # dict: {'F': [250, 250, 250, 250], 'W': [...], ...}
    n = plan.step_count()     # tổng số bước
    t = plan.estimated_secs() # thời gian ước tính (giây)

Mọi hàm là pure: cùng đầu vào → cùng đầu ra. Unit test được viết riêng
không cần Qt, không cần game.

================================================================================
CÁC HẠNG SỐ (đưa ra ngoài để dễ chỉnh)
================================================================================
"""

# Số bước tối đa mỗi lần bấm (chống chạy quá lâu).
GRANT_MAX_STEPS = 120

# Mức cộng tối đa mỗi bước, theo phút vào trận.
GRANT_STEP_P1 = 10   # phút 1
GRANT_STEP_MID = 20  # phút 2–5
GRANT_STEP_LATE = 30 # phút 6–9
GRANT_STEP_M10 = 40  # phút 10
GRANT_STEP_ADD = 10  # +100 mỗi phút sau phút 10
GRANT_STEP_MAX = 100 # chặn trên (phút 16 trở đi)

# Khoảng cách giữa các bước (ms).
GRANT_STEP_GAP_MS = 300  # chế độ từ từ
GRANT_FAST_GAP_MS = 300  # chế độ nhanh (bằng nhau để không bị chậm hơn)
GRANT_FAST_STEPS = 4     # số bước tối đa ở chế độ nhanh


# ---------------------------------------------------------------------------
# HÀM HỖ TRỢ
# ---------------------------------------------------------------------------

def step_cap_for_minute(mins: int) -> int:
    """Mức cộng tối đa mỗi bước tại phút `mins` vào trận."""
    if mins <= 1:
        cap = GRANT_STEP_P1
    elif mins <= 5:
        cap = GRANT_STEP_MID
    elif mins <= 9:
        cap = GRANT_STEP_LATE
    else:
        # phút 10 -> 40, phút 11 -> 50, ...
        cap = GRANT_STEP_M10 + GRANT_STEP_ADD * (mins - 10)
    return max(GRANT_STEP_P1, min(GRANT_STEP_MAX, cap))


def split_amount(total: int, cap: int, max_steps: int) -> list:
    """
    Chia `total` thành các bước, mỗi bước <= `cap`, số bước <= `max_steps`.

    Quy tắc:
      - Số bước = max(1, ceil(total / cap)).
      - Nếu số bước vượt quá `max_steps`, tăng `cap` lên cho đến khi bước
        xuống dưới hoặc bằng `max_steps`.
      - Phân phối đều, phần dư dồn vào bước ĐẦU TIÊN (để khách nhìn thấy
        con số lớn trước).
      - Các bước có giá trị 0 bị loại.

    Ví dụ:
      total=10000, cap=40, max_steps=4
        -> n = ceil(10000/40) = 250 > 4 -> cap = ceil(10000/4) = 2500
        -> [2500, 2500, 2500, 2500]

      total=1000, cap=10, max_steps=4
        -> n = ceil(1000/10) = 100 > 4 -> cap = ceil(1000/4) = 250
        -> [250, 250, 250, 250]

      total=1000, cap=30, max_steps=10
        -> n = ceil(1000/30) = 34 > 10 -> cap = ceil(1000/10) = 100
        -> [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]

      total=1000, cap=100, max_steps=4
        -> n = ceil(1000/100) = 10 > 4 -> cap = ceil(1000/4) = 250
        -> [250, 250, 250, 250]
    """
    if total <= 0:
        return []

    # Bước 1: số bước cần nếu dùng `cap`.
    n = (total + cap - 1) // cap

    # Bước 2: nếu vượt quá max_steps, tăng cap cho đủ bước.
    if n > max_steps:
        cap = max(cap, (total + max_steps - 1) // max_steps)
        n = (total + cap - 1) // cap

    # Bước 3: phân phối đều, phần dư dồn vào bước đầu.
    base = total // n
    rem = total - base * n
    steps = [base] * n
    steps[0] += rem

    # Các bước bằng 0 bị loại (có thể xảy ra nếu total < n).
    return [x for x in steps if x > 0]


# ---------------------------------------------------------------------------
# QUY TẮC CHÍNH
# ---------------------------------------------------------------------------

class GrantPlan:
    """Lập kế hoạch cộng cho MỘT lần bấm nút.

    Ví dụ:
        plan = GrantPlan({'F': 1000, 'W': 500}, mins=1, fast=False)
        print(plan.steps())   # {'F': [100]*10, 'W': [100]*5}
        print(plan.step_count())  # 15
        print(plan.estimated_secs())  # 14 * 0.3 = 4.2
    """

    def __init__(self, amounts: dict, mins: int, fast: bool = False,
                 step_cap_override: int = None):
        """
        amounts: dict {res: amount} — ví dụ {'F': 1000, 'W': 500}.
        mins: phút vào trận (dùng để chọn mức cộng caps).
        fast: chế độ nhanh (chuột phải) — ít bước lớn hơn.
        step_cap_override: chỉ dùng trong test, ghi đè cấp tự tính.
        """
        self.amounts = {k: int(v or 0) for k, v in (amounts or {}).items()
                        if v}
        self.mins = max(1, int(mins))
        self.fast = bool(fast)
        self.step_cap_override = step_cap_override

        self._plans = {}
        self._total_steps = 0
        self._build()

    def _build(self):
        """Xây dựng kế hoạch cho mỗi loại tài nguyên trong `amounts`."""
        cap = self.step_cap_override if self.step_cap_override is not None \
            else step_cap_for_minute(self.mins)

        for res, total in self.amounts.items():
            cap_r = cap
            if self.fast:
                # Chế độ nhanh: chia thành <= GRANT_FAST_STEPS bước.
                by_steps = (total + GRANT_FAST_STEPS - 1) \
                    // GRANT_FAST_STEPS
                cap_r = max(cap_r, by_steps)

                # Nếu cap_từ_từ lớn hơn, giữ nguyên để không bị chậm hơn.
                # (Ví dụ: phút 10, +100: từ_từ = 4 bước x 40 = 1s,
                #  nếu nhanh = 4 bước x 250 = 1s — bằng nhau, không chậm hơn.)

                # Nếu vẫn còn vượt quá max_steps sau khi tăng, tăng tiếp.
                need_n = (total + cap_r - 1) // cap_r
                if need_n > GRANT_MAX_STEPS:
                    cap_r = max(cap_r, (total + GRANT_MAX_STEPS - 1)
                                // GRANT_MAX_STEPS)

            self._plans[res] = split_amount(total, cap_r, GRANT_MAX_STEPS)

        self._total_steps = sum(len(q) for q in self._plans.values())

    def steps(self) -> dict:
        """Trả dict {res: [bước1, bước2, ...]} — chỉ chứa các bước > 0."""
        return {k: list(v) for k, v in self._plans.items() if v}

    def step_count(self) -> int:
        """Tổng số bước (tổng số lần gọi engine)."""
        return self._total_steps

    def estimated_secs(self) -> float:
        """Thời gian ước tính (giây), tính theo khoảng cách giữa các bước."""
        gap = GRANT_FAST_GAP_MS if self.fast else GRANT_STEP_GAP_MS
        # Khoảng cách giữa các bước = (số bước - 1) * gap.
        # Các loại khác nhau chạy XEN KẼ (xen kẽ trong _x2_tick), nên tổng
        # thời gian ≈ số bước tổng cộng * gap, không phải sum mỗi loại.
        if self._total_steps <= 0:
            return 0.0
        return (self._total_steps - 1) * gap / 1000.0

    def steps_for(self, res) -> list:
        """Danh sách bước của một loại (rỗng nếu không có)."""
        return list(self._plans.get(res, []))

    def __repr__(self):
        return 'GrantPlan(amounts=%r, mins=%d, fast=%s, steps=%d)' % (
            self.amounts, self.mins, self.fast, self._total_steps)
