// 运行：node scripts/run-smoke.cjs
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const outDir = path.join(__dirname, '..', '.tmp-test');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execSync(
  `npx tsc -p src/tsconfig.test.json`,
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);

// 工作区根 package.json 是 type=module，给测试产物目录打上 commonjs 标记
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

// localStorage shim
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

require(path.join(outDir, 'test', 'smoke.js'));
