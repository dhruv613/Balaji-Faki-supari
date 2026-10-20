// Keep server credentials out of tracked files and retired provider settings out of runtime code.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of tracked) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (/\b(?:npg_|nsk_live_)[A-Za-z0-9]{12,}/.test(text)) problems.push(`${file}: contains a live credential`);
}

function inspect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') inspect(file);
    } else if (/\.(?:ts|tsx|py)$/.test(file)) {
      const text = readFileSync(resolve(root, file), 'utf8');
      if (/@supabase\//.test(text) || /\b(?:VITE_)?SUPABASE_(?:URL|SECRET_KEY|JWT_SECRET|PUBLISHABLE_KEY)\b/.test(text)) {
        problems.push(`${file}: still uses the retired provider`);
      }
    }
  }
}
for (const directory of ['frontend/src', 'admin-panel/src', 'backend/app']) inspect(directory);
const config = readFileSync(resolve(root, 'neon.ts'), 'utf8');
if (!/auth:\s*true/.test(config) || !/access:\s*["']private["']/.test(config)) problems.push('neon.ts: Auth and private storage must be declared');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Neon configuration check passed: no retired runtime provider or tracked Neon credentials.');
