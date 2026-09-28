const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const root = 'apps/desktop/artifacts';
const files = readdirSync(root).filter(name => /^Yapper-.*\.(exe|AppImage|tar\.gz)$/.test(name)).sort();
if (!files.length) throw new Error('No distributable desktop artifacts');
const lines = files.map(name => `${createHash('sha256').update(readFileSync(join(root,name))).digest('hex')}  ${name}`);
writeFileSync(join(root, `SHA256SUMS-${process.platform}`), lines.join('\n') + '\n');
