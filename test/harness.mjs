/**
 * harness.mjs — bộ chạy kiểm thử tối giản, không phụ thuộc thư viện ngoài.
 *
 *   node test/run.mjs
 */

export class Suite {
  constructor(name) {
    this.name = name;
    this.pass = 0;
    this.fail = 0;
    this.failures = [];
    this.sectionName = '';
  }

  section(t) {
    this.sectionName = t;
    console.log(`\n─ ${t}`);
  }

  ok(cond, label, detail = '') {
    if (cond) {
      this.pass++;
      console.log(`  ✓ ${label}`);
    } else {
      this.fail++;
      const full = `${this.sectionName ? this.sectionName + ' › ' : ''}${label}${detail ? ` — ${detail}` : ''}`;
      this.failures.push(full);
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    }
    return !!cond;
  }

  eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    return this.ok(a === e, label, a === e ? '' : `nhận ${a}, cần ${e}`);
  }

  throws(fn, label) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        return this.ok(false, label, 'hàm async — dùng throwsAsync');
      }
      return this.ok(false, label, 'không ném lỗi');
    } catch {
      return this.ok(true, label);
    }
  }

  async throwsAsync(fn, label) {
    try {
      await fn();
      return this.ok(false, label, 'không ném lỗi');
    } catch {
      return this.ok(true, label);
    }
  }

  summary() {
    const total = this.pass + this.fail;
    console.log(`\n${'═'.repeat(58)}`);
    console.log(`${this.name}: ${total} kiểm tra | ✓ ${this.pass} | ✗ ${this.fail}`);
    if (this.fail) {
      console.log('\nLỗi:');
      for (const f of this.failures) console.log(`  • ${f}`);
    }
    console.log('═'.repeat(58));
    return this.fail === 0;
  }
}

/** Cắt bớt chuỗi dài khi in. */
export function short(v, n = 120) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}
