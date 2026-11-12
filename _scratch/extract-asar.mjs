import fs from 'node:fs';
import path from 'node:path';

const asarPath = process.argv[2];
const outDir = process.argv[3];
const targets = process.argv.slice(4);

const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hb = Buffer.alloc(headerSize);
fs.readSync(fd, hb, 0, headerSize, 16);
let base = 16 + headerSize;
if (base % 4 !== 0) base += 4 - (base % 4);
const tree = JSON.parse(hb.toString('utf8'));

fs.mkdirSync(outDir, { recursive: true });

function lookup(parts) {
  let node = tree;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

for (const target of targets) {
  const parts = target.split('/');
  const node = lookup(parts);
  if (!node || node.offset === undefined) {
    console.log('missing: ' + target);
    continue;
  }
  const size = Number(node.size);
  const offset = Number(node.offset);
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, base + offset);
  const dest = path.join(outDir, parts.slice(-2).join('-'));
  fs.writeFileSync(dest, buf);
  console.log('wrote ' + dest + ' (' + size + ' bytes)');
}
fs.closeSync(fd);
