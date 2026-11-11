import re, os, json

ROOT = r'C:\Users\ADMIN\Desktop\muabankey\src'

# collect all async function names defined in the project
asyncfns = set()
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if not f.endswith('.js'): continue
        src = open(os.path.join(dp, f), encoding='utf-8').read()
        for m in re.finditer(r'export\s+async\s+function\s+(\w+)', src):
            asyncfns.add(m.group(1))
        for m in re.finditer(r'async\s+function\s+(\w+)', src):
            asyncfns.add(m.group(1))
        for m in re.finditer(r'const\s+(\w+)\s*=\s*async', src):
            asyncfns.add(m.group(1))
# known async helpers
asyncfns |= {'requireUser','requireAdmin','requireAdminStrict','getSessionUser',
             'rateLimit','readJson','audit','consumeUse','getQuota','refundUse',
             'checkWhitelist','activeUse','deviceAccountCount','countRecent',
             'trialCfg','deriveIds','sha256hex','hashPassword','verifyPassword',
             'syncStock','releaseCoupon','deliverLicenseLine','issueLicenses',
             'readLicense','setRevoked','extendLicense','recordIssue',
             'createSession','destroySession','purgeExpiredSessions',
             'tgCall','tgConfig','tgTest','notifyTopup','handleCallback',
             'tgAnswerCallback','tgUpdateMessage','publicUse','looksVirtual',
             'normKind','anchor_server_time'}
asyncfns -= {'normKind','looksVirtual','publicUse','anchor_server_time'}

hits = []
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if not f.endswith('.js'): continue
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, r'C:\Users\ADMIN\Desktop\muabankey')
        src = open(p, encoding='utf-8').read()
        for i, line in enumerate(src.split('\n'), 1):
            for name in asyncfns:
                # a bare call statement: name(...) at statement position, no await
                if re.search(r'(?<![\w.$])' + name + r'\s*\(', line):
                    stripped = line.strip()
                    if stripped.startswith('//') or stripped.startswith('*'): continue
                    # skip when preceded by await / return / = / imports / function decl
                    seg = line
                    for m in re.finditer(r'(?<![\w.$])(' + name + r')\s*\(', seg):
                        pre = seg[max(0, m.start()-14):m.start()]
                        rest = seg[:m.start()]
                        if re.search(r'await\s*$', rest): continue
                        if re.search(r'(=|\(|,|return|:|\[|!|&&|\|\||\?|\bvoid)\s*$', rest): continue
                        if re.search(r'(function|async|import|export|//|\*)\s*\S*$', pre): continue
                        # statement starting with the call
                        if re.match(r'^\s*' + name + r'\s*\($', rest) or re.match(r'^\s*' + name + r'\s*\(', seg):
                            hits.append({'file': rel, 'line': i, 'call': name, 'text': stripped[:130]})
print(json.dumps(hits, ensure_ascii=False, indent=1))
