/**
 * Thong tin phien ban bo cai (cong khai, khong can dang nhap).
 *
 *   GET /api/app/version
 *   -> { ok, name, filename, version, sha256, size, sizeText, url, urlAbsolute, platform }
 *
 * VI SAO CO ENDPOINT NAY:
 * Trang /tai-ve hien hash SHA-256 va dung luong de khach tu doi chieu. Truoc
 * day ba gia tri do chi ton tai duoi dang hang so trong src/routes/installer.js
 * va khong noi nao doc ra duoc, nen frontend phai chep tay -> moi lan phat hanh
 * ban moi la phai sua 2 cho va rat de lech. Lech hash nghia la khach tai DUNG
 * file nhung so sanh voi hash SAI roi tuong file bi chen -> mat don hang.
 *
 * Cache: `ok()` -> `json()` da dat `Cache-Control: no-store`, nen ban moi len
 * la khach thay ngay, khong phai xoa cache trinh duyet.
 */
import { ok } from '../lib/http.js';
import { arenaVersionData } from './arena-installer.js';

/** Dinh dang byte -> chuoi de doc. Co dinh, khong phu thuoc Intl cua may khach. */
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** GET /api/app/version — public, khong doc DB. */
export async function appVersion(env, request) {
  // arena = EXE GOP (ca map sang + tai nguyen). Client doc field nay
    // de biet co ban moi hay khong.
    // CHI MOT app duy nhat: 'arena' la EXE gop chua ca map sang lan
    // tai nguyen. Khong tra them 'grant'/'nofog' nua — chu shop yeu
    // cau mot app, mot bo cai, de khoi roi.
    /*
     * MỘT APP DUY NHẤT.
     *
     * Cấp gốc chính là app gộp (XA ARENA). Client đời cũ đọc
     * `version`/`url` ở cấp gốc sẽ nhận đúng bản gộp, không còn
     * bị trỏ về xa_nofog_pro.exe như trước.
     * Field `arena` giữ lại để client mới đọc rõ ràng.
     */
    const arena = arenaVersionData(request, env);
    return ok({ ...arena, arena });
}
