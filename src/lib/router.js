/** Router tối giản: đăng ký route theo method + path pattern. */

export class Router {
  constructor() {
    /** @type {Array<{method:string,parts:string[],handler:Function,authLevel:string}>} */
    this.routes = [];
  }

  add(method, pattern, handler, meta = {}) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), parts, handler, meta });
    return this;
  }

  get(p, h, m) { return this.add('GET', p, h, m); }
  post(p, h, m) { return this.add('POST', p, h, m); }
  patch(p, h, m) { return this.add('PATCH', p, h, m); }
  put(p, h, m) { return this.add('PUT', p, h, m); }
  delete(p, h, m) { return this.add('DELETE', p, h, m); }

  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    const allowed = new Set();
    for (const route of this.routes) {
      if (route.parts.length !== segs.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < route.parts.length; i++) {
        const rp = route.parts[i];
        if (rp.startsWith(':')) {
          params[rp.slice(1)] = decodeURIComponent(segs[i]);
        } else if (rp !== segs[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathMatched = true;
      allowed.add(route.method);
      if (route.method === method.toUpperCase()) {
        return { handler: route.handler, params, meta: route.meta };
      }
    }
    if (pathMatched) return { methodNotAllowed: [...allowed] };
    return null;
  }
}
