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
import { APP_NAME, EXE_NAME, EXE_VERSION, EXE_SHA256, EXE_SIZE } from './installer.js';
import { EXE_SHA256 as GRANT_SHA, EXE_SIZE as GRANT_SIZE } from './xa-grant-installer.js';

/** Dinh dang byte -> chuoi de doc. Co dinh, khong phu thuoc Intl cua may khach. */
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Du lieu phien ban — tach rieng de dung lai o cho khac neu can. */
export function appVersionData(request) {
  const u = new URL(request.url);
  const base = `${u.protocol}//${u.host}`;
  return {
    name: APP_NAME,
    filename: EXE_NAME,
    version: EXE_VERSION,
    sha256: EXE_SHA256,
    // So nguyen byte: client tu dinh dang, tranh truyen chuoi roi phai parse lai.
    size: EXE_SIZE,
    sizeText: humanSize(EXE_SIZE),
    // Duong dan TUONG DOI de doi ten mien khong phai sua gi.
    url: `/download/${EXE_NAME}`,
    urlAbsolute: `${base}/download/${EXE_NAME}`,
    platform: 'Windows 10 / 11 (64-bit)',
  };
}

/** Du lieu phien ban XA_grant (them tai nguyen). */
export function grantVersionData(request) {
  const u = new URL(request.url);
  const base = `${u.protocol}//${u.host}`;
  return {
    name: 'XA THÊM TÀI NGUYÊN',
    filename: 'xa_grant.exe',
    version: '',
    sha256: GRANT_SHA,
    size: GRANT_SIZE,
    sizeText: humanSize(GRANT_SIZE),
    url: '/download/xa_grant.exe',
    urlAbsolute: `${base}/download/xa_grant.exe`,
    platform: 'Windows 10 / 11 (64-bit)',
  };
}

/** GET /api/app/version — public, khong doc DB. */
export async function appVersion(env, request) {
  return ok({ ...appVersionData(request), grant: grantVersionData(request) });
}
