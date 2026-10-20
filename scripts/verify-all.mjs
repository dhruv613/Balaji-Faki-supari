import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

function step(label, command, cwd = rootDir) {
  console.log(`\n=== [VERIFY] ${label} ===`);
  execSync(command, { cwd, stdio: 'inherit' });
}

step('0. Neon runtime and credential check', 'node scripts/check-neon-config.mjs');
// Like D&D: the store (frontend/) and the Admin Panel (admin-panel/) are separate apps, each with its own install.
step('1. Store: TypeScript', 'npm run typecheck', resolve(rootDir, 'frontend'));
step('2. Store: tests (checkout, secondary pages, auth, orders)', 'npm test', resolve(rootDir, 'frontend'));
step('3. Admin Panel: TypeScript', 'npm run typecheck', resolve(rootDir, 'admin-panel'));
step('4. Admin Panel: tests (route guard, modules, DB schema, self-contained)', 'npm test', resolve(rootDir, 'admin-panel'));
step('5. Backend tests', 'python -m unittest discover -s backend/tests');
step('6. Store build', 'npm run build', resolve(rootDir, 'frontend'));
step('7. Admin Panel build', 'npm run build', resolve(rootDir, 'admin-panel'));

const requiredPaths = [
  'frontend/src/app/App.tsx',
  'frontend/src/app/router.tsx',
  'frontend/dist/index.html',
  'admin-panel/src/app/App.tsx',
  'admin-panel/package-lock.json',
  'frontend/package-lock.json',
  'admin-panel/dist/index.html',
  'admin-panel/vercel.json',
  'vercel.json',
  'api/index.py',
  'requirements.txt',
  'docs/VERCEL_DEPLOYMENT.md',
  'scripts/check-neon-config.mjs',
  'backend/migrations/neon/001_schema.sql',
  'backend/migrations/neon/002_catalog.sql',
  'backend/migrations/neon/003_neon_identity.sql',
  'docs/design-reference/Balaji Faki Point – Website UI (1).html',
  'docs/design-reference/Balaji Faki Point – Website UI (1).pdf',
  'backend/requirements.txt',
  'backend/app/core/config.py',
  'backend/app/core/security.py',
  'backend/app/main.py',
  'backend/tests/test_security.py',
  'backend/tests/test_api_workflow.py',
];

for (const relPath of requiredPaths) {
  if (!existsSync(resolve(rootDir, relPath))) {
    throw new Error(`Missing expected path: ${relPath}`);
  }
}

console.log('\nAll workspace verification checks passed.');
