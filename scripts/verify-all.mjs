import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

function step(label, command, cwd = rootDir) {
  console.log(`\n=== [VERIFY] ${label} ===`);
  execSync(command, { cwd, stdio: 'inherit' });
}

step('1. Frontend TypeScript Validation', 'npm run typecheck');
step('2. Automated Test Suites (Checkout, Secondary Pages, Auth, Admin & DB Schema)', 'npm test');
step('3. Production Vite Build', 'npm run build');

const requiredPaths = [
  'frontend/src/app/App.tsx',
  'frontend/src/app/router.tsx',
  'frontend/dist/index.html',
  'supabase/migrations/20261017000000_balaji_faki_point_schema.sql',
  'supabase/migrations/20261017000001_optimize_rls_and_security_advisors.sql',
  'supabase/migrations/20261017000002_simple_db_auth.sql',
  'docs/design-reference/Balaji Faki Point – Website UI (1).html',
  'docs/design-reference/Balaji Faki Point – Website UI (1).pdf',
  'backend/package.json',
];

for (const relPath of requiredPaths) {
  if (!existsSync(resolve(rootDir, relPath))) {
    throw new Error(`Missing expected path: ${relPath}`);
  }
}

console.log('\nAll workspace verification checks passed.');
