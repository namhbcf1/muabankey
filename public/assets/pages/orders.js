/** Trang đơn hàng của tôi. */

import {

  api, esc, fmtVnd, fmtNum, fmtDate, toast, navigate, loadingBlock,

  copyText, timeAgo, decodeKey, emptyBlock, openModal,

} from '../lib.js';

import { icon } from '../icons.js';

import { state } from '../state.js';



// tone + nhãn + icon cho từng trạng thái đơn.

const STATUS_MAP = {

  pending: ['pill-yellow', 'Chờ chuyển khoản', 'clock'],

  expired: ['pill-gray', 'Hết hạn', 'clock'],

  processing: ['pill-blue', 'Đang giao key', 'package'],

  paid: ['pill-blue', 'Đã thanh toán', 'card'],

  delivered: ['pill-green', 'Đã giao', 'checkCircle'],

  cancelled: ['pill-gray', 'Đã huỷ', 'ban'],

  refunding: ['pill-yellow', 'Đang hoàn tiền', 'undo'],

  refunded: ['pill-red', 'Đã hoàn tiền', 'undo'],

  /*

   * `refund_stuck` do cron ghi khi đơn hoàn tiền bị treo giữa chừng. Thiếu

   * nhãn thì statusPill rơi vào fallback và in nguyên chuỗi tiếng Anh

   * "refund_stuck" cho khách đọc.

   */

  refund_stuck: ['pill-yellow', 'Hoàn tiền chờ xử lý', 'clock'],

};



/** Nhãn trạng thái có icon — dùng chung cho danh sách và thông báo trong dòng hàng. */

function statusPill(status) {

  const [cls, label, ico] = STATUS_MAP[status] || ['pill-gray', status, 'help'];

  return `<span class="pill ${cls}">${icon(ico, { size: 11 })} ${esc(label)}</span>`;

}



export function renderOrders() {

  return `

  <div id="site-header"></div>

  <section class="section-sm">

    <div class="container">

      <nav class="pd-breadcrumb" aria-label="Đường dẫn">

        <a href="#/">Trang chủ</a><span>/</span><span>Đơn hàng</span>

      </nav>

      <div class="page-head">

        <div>

          <h1 class="page-title">Đơn hàng của tôi</h1>

          <p class="page-desc">Xem lại key đã mua và trạng thái từng đơn.</p>

        </div>

      </div>

      <div id="orders-content">${loadingBlock()}</div>

    </div>

  </section>

  <div id="site-footer"></div>`;

}



export async function mountOrders(root) {

  const host = root.querySelector('#orders-content');

  if (!state.user) { navigate('/login?redirect=/orders', { replace: true }); return; }



  try {

    const data = await api('/api/orders?perPage=50');

    if (data.orders.length === 0) {

      host.innerHTML = emptyBlock({

        ico: 'package',

        title: 'Chưa có đơn hàng nào',

        desc: 'Các đơn đã mua và key đi kèm sẽ xuất hiện tại đây.',

        action: `<button class="btn btn-primary btn-sm" data-empty-go="/products">Xem sản phẩm</button>`,

      });

      host.querySelector('[data-empty-go]').onclick = () => navigate('/products');

      return;

    }



    host.innerHTML = `<div class="stack">${data.orders.map((o) => {

      const allKeys = o.items.flatMap((i) => i.keys);

      return `

      <article class="panel" aria-label="Đơn ${esc(o.code)}">

        <div class="order-head">

          <div>

            <div class="pill-row">

              <span class="order-code">${esc(o.code)}</span>

              ${statusPill(o.status)}

            </div>

            <div class="order-time">${esc(fmtDate(o.createdAt))} · ${esc(timeAgo(o.createdAt))}</div>

          </div>

          <div class="order-sum">

            <div class="amt">${fmtVnd(o.total)}</div>

            ${o.discount > 0 ? `<div class="disc">Đã giảm ${fmtVnd(o.discount)}</div>` : ''}

          </div>

        </div>



        <div class="order-body">

          ${o.items.map((i) => `

            <div class="line-item">

              <div class="line-head">

                <div class="line-name">${esc(i.name)} <span class="line-qty">× ${fmtNum(i.quantity)}</span></div>

                <div class="line-amt">${fmtVnd(i.lineTotal)}</div>

              </div>

              ${i.keys.length

                ? i.keys.map((k) => {

                    const key = decodeKey(k);

                    const isLic = /^[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key);

                    /*

                     * Key kiểu "account" lưu dạng base64("email|mật khẩu"). Hiển

                     * thị nguyên chuỗi thì khách phải tự tách dấu "|" mới đăng

                     * nhập được. Tách sẵn thành 2 dòng có nút sao chép riêng.

                     */

                    const parts = !isLic && key.includes('|') ? key.split('|') : null;

                    return `

                  <div class="key-box">

                    ${parts

                      ? `<div class="cred">

                           <div class="cred-row">

                             <span class="cred-k">Tài khoản</span>

                             <span class="cred-v mono">${esc(parts[0])}</span>

                             <button class="key-copy" data-copy="${esc(parts[0])}" aria-label="Sao chép tài khoản">

                               ${icon('copy', { size: 12 })}

                             </button>

                           </div>

                           <div class="cred-row">

                             <span class="cred-k">Mật khẩu</span>

                             <span class="cred-v mono">${esc(parts.slice(1).join('|'))}</span>

                             <button class="key-copy" data-copy="${esc(parts.slice(1).join('|'))}" aria-label="Sao chép mật khẩu">

                               ${icon('copy', { size: 12 })}

                             </button>

                           </div>

                         </div>`

                      : `<div class="key-value">${esc(key)}</div>

                         <button class="key-copy" data-copy="${esc(key)}">

                           ${icon('copy', { size: 12 })} Sao chép

                         </button>`}

                  </div>

                  ${isLic ? `<div class="line-note mono">

                    ${icon('bolt', { size: 12 })} Cài đặt:

                    <a href="/download/xa_setup.exe" download="xa_setup.exe"
                       class="key-copy" style="margin-left:6px;text-decoration:none">
                      ${icon('download', { size: 12 })} Tải bộ cài
                    </a>

                    <button class="key-copy" data-install="${esc(key)}" style="margin-left:6px">

                      ${icon('copy', { size: 12 })} Copy mã

                    </button>

                    <a href="#/licenses" class="text-dim" style="margin-left:8px">Chi tiết</a>

                  </div>` : ''}`;

                  }).join('')

                : o.status === 'pending'

                  ? `<div class="line-note warn">${icon('clock', { size: 12 })} Chờ thanh toán để nhận key</div>`

                  : `<div class="line-note">${icon('progress', { size: 12 })} Đang xử lý giao hàng</div>`}

            </div>`).join('')}

        </div>



        ${o.status === 'pending' ? `

          <div class="order-foot">

            <button class="btn btn-primary btn-sm" data-pay="${esc(o.id)}">

              ${icon('card', { size: 13 })} Thanh toán ngay

            </button>

          </div>` : ''}



        ${allKeys.length > 0 ? `

          <div class="order-foot">

            <button class="btn btn-ghost btn-sm" data-copy-all="${esc(JSON.stringify(allKeys.map((k) => decodeKey(k))))}">

              ${icon('copy', { size: 13 })} Sao chép tất cả key

            </button>

            <a class="btn btn-ghost btn-sm" href="mailto:?subject=Key%20${encodeURIComponent(o.code)}&body=${encodeURIComponent(allKeys.map((k) => decodeKey(k)).join('\n'))}">

              ${icon('mail', { size: 13 })} Gửi qua email

            </a>

          </div>` : ''}

      </article>`;

    }).join('')}</div>`;



    host.querySelectorAll('[data-copy]').forEach((b) => {

      b.onclick = async () => {

        const ok = await copyText(b.dataset.copy);

        toast(ok ? 'Đã sao chép key' : 'Không thể sao chép', ok ? 'success' : 'error');

      };

    });



    host.querySelectorAll('[data-copy-all]').forEach((b) => {

      b.onclick = async () => {

        const keys = JSON.parse(b.dataset.copyAll).join('\n');

        const ok = await copyText(keys);

        toast(ok ? 'Đã sao chép tất cả key' : 'Không thể sao chép', ok ? 'success' : 'error');

      };

    });



    /*

     * Copy lệnh cài đặt: lấy token tươi từ server rồi copy.

     * Token sống 24h — copy lần trước có thể đã hết hạn, nên luôn xin mới

     * thay vì lưu sẵn trong HTML.

     */

    host.querySelectorAll('[data-install]').forEach((b) => {

      b.onclick = async () => {

        const key = b.dataset.install;

        const orig = b.innerHTML;

        b.disabled = true;

        b.innerHTML = `${icon('progress', { size: 12 })} Đang lấy...`;

        try {

          const r = await api(`/api/licenses/${encodeURIComponent(key)}/install-token`, {

            method: 'POST',

          });

          /*
           * Copy MÃ CÀI ĐẶT (token), không phải lệnh PowerShell.
           *
           * Trước đây chỗ này copy một dòng `powershell -ExecutionPolicy
           * Bypass ... iex (irm ...)`. Nay khách dán token vào bộ cài GUI.
           */
          const paste = r.token || '';

          const ok = await copyText(paste);

          if (ok) {

            toast('Đã copy mã cài đặt. Mở bộ cài, dán vào ô rồi bấm Cài đặt.',
              'success', 7000);

          } else {

            // Không copy được -> hiện hộp thoại để khách tự bôi đen

            openModal(`

              <div style="padding:18px 20px">

                <div style="font-size:15px;font-weight:800;margin-bottom:10px">

                  Mã cài đặt

                </div>

                <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">

                  Mở file <code>xa_setup.exe</code> đã tải, dán mã dưới

                  vào ô rồi bấm <strong>Cài đặt</strong>:

                </p>

                <div class="mono" style="font-size:11px;line-height:1.7;word-break:break-all;

                  background:rgba(0,0,0,.5);padding:12px;border-radius:8px;

                  border:1px solid rgba(74,222,128,.35);color:#4ade80;user-select:all">${esc(paste)}</div>

                <button class="btn btn-primary btn-block btn-sm mt-1" data-close-modal>

                  Đóng

                </button>

              </div>`, {

              onMount: (m) => {

                m.querySelector('[data-close-modal]')?.addEventListener('click', () => {

                  m.closest('.modal-overlay')?.remove();

                });

              },

            });

          }

        } catch (e) {

          toast(e.message || 'Không lấy được lệnh cài', 'error', 6000);

        } finally {

          b.disabled = false;

          b.innerHTML = orig;

        }

      };

    });



    host.querySelectorAll('[data-pay]').forEach((b) => {

      b.onclick = () => {

        // Chuyển sang trang thanh toán QR của đơn (không trừ ví)

        navigate(`/order/${b.dataset.pay}`);

      };

    });

  } catch (e) {

    host.innerHTML = emptyBlock({ ico: 'alert', title: e.message || 'Không tải được đơn hàng' });

  }

}

