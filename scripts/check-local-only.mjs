// Fails when local development could reach the online Supabase project.
// Run via `npm run verify` or `node scripts/check-local-only.mjs`. Never prints env values.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const PROD_REF = ['zyzkoolgwbczvvet', 'jnwf'].join(''); // split so this file never matches itself
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// 1. Tracked source/config must not name the production project (historical docs and agent skill docs excluded).
const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of tracked) {
  if (file.startsWith('docs/') || file.startsWith('.agents/') || file === 'scripts/check-local-only.mjs') continue;
  const abs = resolve(root, file);
  if (!existsSync(abs)) continue; // staged deletion
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { continue; }
  if (text.includes(PROD_REF)) problems.push(`${file}: references the online Supabase project`);
}

// 2. MCP config must not list remote servers.
const mcpPath = resolve(root, '.mcp.json');
if (existsSync(mcpPath)) {
  const servers = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers ?? {};
  for (const [name, cfg] of Object.entries(servers)) {
    const url = cfg.url ?? cfg.serverUrl;
    if (url && !LOCAL_HOSTS.has(new URL(url).hostname)) problems.push(`.mcp.json: server "${name}" is not local`);
  }
}

// 3. The CLI must not be linked to a remote project.
for (const f of ['project-ref', 'linked-project.json', 'pooler-url']) {
  if (existsSync(resolve(root, 'supabase/.temp', f))) problems.push(`supabase/.temp/${f}: CLI is linked to a remote project`);
}
const cfgPath = resolve(root, 'supabase/config.toml');
const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg)?.[1];
if (!projectId || projectId === PROD_REF) problems.push('supabase/config.toml: project_id must be a local name');
if (/^enable_confirmations\s*=\s*true/m.test(cfg)) problems.push('supabase/config.toml: local email confirmation must be off');

// 4. Every URL-valued setting in the .env files must be local (values are never printed).
for (const envFile of ['.env', 'backend/.env', 'frontend/.env']) {
  const abs = resolve(root, envFile);
  if (!existsSync(abs)) continue;
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = m;
    for (const candidate of raw.replace(/^["']|["']$/g, '').split(',')) {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate.trim())) continue;
      let host;
      try { host = new URL(candidate.trim().replace(/^postgresql\+\w+:/, 'postgresql:')).hostname; } catch { continue; }
      if (!LOCAL_HOSTS.has(host)) problems.push(`${envFile}: ${key} points to a non-local host`);
    }
  }
}

if (problems.length) {
  console.error('LOCAL-ONLY CHECK FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('Local-only check passed: no online Supabase reference in active config.');
