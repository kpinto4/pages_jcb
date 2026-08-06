/**
 * npm start       → solo frontend (ng serve :3015)
 * npm start dev   → frontend + backend (npm run dev)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const wantsDev = process.argv.slice(2).some((a) => a === 'dev');

if (wantsDev) {
  const r = spawnSync('npm', ['run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env
  });
  process.exit(r.status ?? 1);
}

const r = spawnSync('npx', ['ng', 'serve'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env
});
process.exit(r.status ?? 1);
