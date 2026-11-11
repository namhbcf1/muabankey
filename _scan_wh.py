import re
p = r'C:\Users\ADMIN\Desktop\muabankey\src\routes\wallet.js'
lines = open(p, encoding='utf-8').read().split('\n')
keys = ['UPDATE topups', 'changes', "=== 'paid'", "!= 'paid'"]
for label, a, b in (('payos', 195, 344), ('sepay-live', 739, 812)):
    print('===', label, '===')
    for i in range(a-1, min(b, len(lines))):
        l = lines[i]
        if 'UPDATE topups' in l or 'claim' in l or "=== 'paid'" in l or "!= 'paid'" in l:
            print(i+1, l.strip()[:130])
