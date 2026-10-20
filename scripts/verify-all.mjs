import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

function step(label, command, cwd = rootDir) {
  console.log(`\n=== [VERIFY] ${label} ===`);
  execSync(command, { cwd, stdio: 'inherit' });
}

step('0. Neon runtime and credential check', 'node scripts/check-neon-config.mjs');
step('1. Frontend TypeScript Validation', 'npm run typecheck');
step('2. Automated Test Suites (Checkout, Secondary Pages, Auth, Admin & DB Schema)', 'npm test');
step('3. Backend FastAPI Security & JWT Verification Tests', 'python -m unittest discover -s backend/tests -v');
step('4. Local Vite Build', 'npm run build');
step('5. Admin Panel Build', 'npm run build:admin');

const requiredPaths = [
  'frontend/src/app/App.tsx',
  'frontend/src/app/router.tsx',
  'frontend/dist/index.html',
  'admin-panel/frontend/src/app/App.tsx',
  'admin-panel/frontend/dist/index.html',
  'admin-panel/vercel.json',
  'admin-panel/backend/README.md',
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
