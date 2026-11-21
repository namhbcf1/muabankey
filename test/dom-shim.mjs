/**
 * dom-shim.mjs — DOM tối thiểu để kiểm thử cấu trúc HTML của SPA mà không
 * cần trình duyệt.
 *
 * VÌ SAO CẦN: lỗi landmark (header/footer nằm trong <main>) là lỗi về CẤU
 * TRÚC DOM. Đọc code bằng mắt dễ đọc sai — chính comment trong app.js đã
 * khẳng định ngược lại với hành vi thật. Cách duy nhất để chắc chắn là DỰNG
 * cây DOM thật rồi kiểm tra quan hệ cha/con.
 *
 * Shim này cố ý giữ nhỏ: chỉ hỗ trợ đúng những gì ensureMain dùng
 * (querySelector, getElementById, childNodes, appendChild, insertBefore,
 * insertAdjacentElement, remove, tagName, id, parentNode).
 */

class Node {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    if (!ref) return this.appendChild(child);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(i, 0, child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  insertAdjacentElement(where, el) {
    if (!this.parentNode) return null;
    if (where === 'afterend') {
      const siblings = this.parentNode.childNodes;
      const i = siblings.indexOf(this);
      if (el.parentNode) el.parentNode.removeChild(el);
      el.parentNode = this.parentNode;
      siblings.splice(i + 1, 0, el);
      return el;
    }
    if (where === 'beforebegin') {
      const siblings = this.parentNode.childNodes;
      const i = siblings.indexOf(this);
      if (el.parentNode) el.parentNode.removeChild(el);
      el.parentNode = this.parentNode;
      siblings.splice(i, 0, el);
      return el;
    }
    return null;
  }

  /* ---- tìm kiếm ---- */
  walk(fn) {
    for (const c of this.childNodes) {
      if (c.nodeType !== 1) continue;
      if (fn(c)) return c;
      const deep = c.walk(fn);
      if (deep) return deep;
    }
    return null;
  }

  matchSimple(sel) {
    // Hỗ trợ: 'tag', '#id', 'tag#id'
    let m = /^([a-zA-Z][\w-]*)#([\w-]+)$/.exec(sel);
    if (m) return this.tagName === m[1].toUpperCase() && this.id === m[2];
    m = /^#([\w-]+)$/.exec(sel);
    if (m) return this.id === m[1];
    if (/^[a-zA-Z][\w-]*$/.test(sel)) return this.tagName === sel.toUpperCase();
    return false;
  }

  querySelector(sel) {
    return this.walk((n) => n.matchSimple(sel));
  }

  querySelectorAll(sel) {
    const out = [];
    const visit = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.matchSimple(sel)) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }

  contains(node) {
    let p = node;
    while (p) {
      if (p === this) return true;
      p = p.parentNode;
    }
    return false;
  }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.className = '';
    this.tabIndex = undefined;
    this._attrs = {};
  }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  focus() { this.doc && (this.doc.activeElement = this); }
}

export class TestDocument extends Node {
  constructor() {
    super();
    this.activeElement = null;
    this.body = new Element('body');
    this.documentElement = new Element('html');
    this.title = '';
    this.head = new Element('head');
    this.body.doc = this;
    this.head.doc = this;
    this.documentElement.doc = this;
    /* document.querySelector cần quét toàn cây, nên gắn documentElement làm gốc. */
    super.appendChild(this.documentElement);
  }

  createElement(tag) {
    const el = new Element(tag);
    el.doc = this;
    return el;
  }

  getElementById(id) {
    return this.walk((n) => n.id === id);
  }

  querySelector(sel) {
    return this.walk((n) => n.matchSimple(sel));
  }

  /* ---- helper cho test ---- */
  /** Trả đường dẫn tổ tiên của một node, ví dụ ['app','main#main-content']. */
  ancestry(node) {
    const out = [];
    let p = node.parentNode;
    while (p) {
      if (p.tagName) {
        out.push(p.id ? `${p.tagName.toLowerCase()}#${p.id}` : p.tagName.toLowerCase());
      } else {
        out.push('document');
      }
      p = p.parentNode;
    }
    return out;
  }

  /** Node này có nằm trong <main> không? */
  insideMain(node) {
    return this.ancestry(node).some((a) => a === 'main#main-content');
  }

  /** In cây cho dễ đọc khi test lỗi. */
  outline(node = this.body, depth = 0) {
    const lines = [];
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      const label = c.id ? `${c.tagName.toLowerCase()}#${c.id}` : c.tagName.toLowerCase();
      lines.push('  '.repeat(depth) + label);
      lines.push(...this.outline(c, depth + 1));
    }
    return lines.join('\n');
  }
}

/* ------------------------------------------------------------------ */
/* Bản shim của ensureMain — ĐÚNG BẢN trong public/assets/app.js       */
/* ------------------------------------------------------------------ */

/**
 * Sao chép logic từ public/assets/app.js. Test dùng hàm này để chứng minh
 * hành vi; đồng thời một test khác so sánh chuỗi mã nguồn để phát hiện lệch.
 *
 * Nếu bạn sửa app.js mà quên sửa đây, test "khớp với app.js" sẽ báo.
 */
export const CHROME_IDS = new Set(['site-header', 'site-footer', 'skip-link']);

export function isChromeNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (CHROME_IDS.has(node.id)) return true;
  if (node.id === 'ai-fab') return true;
  return false;
}

export function ensureMain(app) {
  const existing = app.querySelector('main#main-content');
  if (existing) return existing;

  const doc = app.doc;
  const mainEl = doc.createElement('main');
  mainEl.id = 'main-content';
  mainEl.tabIndex = -1;

  const content = [];
  for (const node of Array.from(app.childNodes)) {
    if (!isChromeNode(node)) content.push(node);
  }
  for (const node of content) mainEl.appendChild(node);

  const headerEl = app.querySelector('#site-header');
  if (headerEl && headerEl.parentNode === app) {
    headerEl.insertAdjacentElement('afterend', mainEl);
  } else {
    app.insertBefore(mainEl, app.firstChild);
  }

  const footerEl = app.querySelector('#site-footer');
  if (footerEl && footerEl.parentNode === app) {
    app.appendChild(footerEl);
  }

  return mainEl;
}

/** Bọc #app vào documentElement để ancestry() đọc được đường dẫn đầy đủ. */
export function attach(doc, app) {
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.body.appendChild(app);
  return app;
}

/**
 * Dựng một #app giống hệt markup của một trang thật:
 *   <div id="site-header"></div> …nội dung… <div id="site-footer"></div>
 */
export function buildApp(doc, html) {
  const app = doc.createElement('div');
  app.id = 'app';
  doc.body.appendChild(app);

  // Parse markup tối giản: đủ để nhận diện các placeholder + vài node nội dung.
  const tagRe = /<(div|section|h1|p|nav|main)\b([^>]*)>/gi;
  let m;
  const stack = [app];
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const el = doc.createElement(tag);
    const idm = /id="([^"]+)"/.exec(attrs);
    if (idm) el.id = idm[1];
    stack[stack.length - 1].appendChild(el);
    // Không cần parse đóng thẻ chính xác: mọi node đều là anh em cùng cấp.
    void stack;
  }
  return app;
}
