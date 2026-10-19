import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

function step(label, command, cwd = rootDir) {
  console.log(`\n=== [VERIFY] ${label} ===`);
  execSync(command, { cwd, stdio: 'inherit' });
}

step('0. Local-only isolation check', 'node scripts/check-local-only.mjs');
step('1. Frontend TypeScript Validation', 'npm run typecheck');
step('2. Automated Test Suites (Checkout, Secondary Pages, Auth, Admin & DB Schema)', 'npm test');
step('3. Backend FastAPI Security & JWT Verification Tests', 'python -m unittest discover -s backend/tests -v');
step('4. Local Vite Build', 'npm run build');

const requiredPaths = [
  'frontend/src/app/App.tsx',
  'frontend/src/app/router.tsx',
  'frontend/dist/index.html',
  'supabase/migrations/20261017000000_balaji_faki_point_schema.sql',
  'supabase/migrations/20261017000001_optimize_rls_and_security_advisors.sql',
  'supabase/migrations/20261017000002_simple_db_auth.sql',
  'supabase/migrations/20261018000000_remediate_auth_and_rls_security.sql',
  'supabase/migrations/20261019000000_product_information.sql',
  'supabase/migrations/20261019000001_review_photos.sql',
  'supabase/migrations/20261020000000_final_security_state.sql',
  'supabase/migrations/20261020000001_catalog_store_content.sql',
  'supabase/migrations/20261020000002_least_privilege_grants.sql',
  'supabase/migrations/20261020000003_screenshot_only_payments.sql',
  'supabase/migrations/20261020000004_faki_packet_images.sql',
  'supabase/migrations/20261020000005_mitho_mavo_and_water.sql',
  'supabase/migrations/20261020000006_faki_real_images_supari_packet.sql',
  'supabase/migrations/20261020000007_faki_gallery_order.sql',
  'supabase/migrations/20261020000008_chuno.sql',
  'scripts/check-local-only.mjs',
  'scripts/check-db-security.py',
  'docs/design-reference/Balaji Faki Point – Website UI (1).html',
  'docs/design-reference/Balaji Faki Point – Website UI (1).pdf',
  'backend/package.json',
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
