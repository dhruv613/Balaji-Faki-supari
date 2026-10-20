// Live probe (not part of `npm test`): runs the real src/lib/auth.ts with the real @neondatabase/auth SDK against a
// Neon branch and the local API, the way the browser does. Usage: node frontend/tests/sdk-probe.mjs <creds.json>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const creds = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = 'http://127.0.0.1:8000';

// The browser keeps Neon Auth's cookies; Node needs a small cookie jar and the page's Origin.
const jar = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.startsWith(creds.authUrl.split('/neondb')[0])) {
    headers.set('Origin', 'http://localhost:5173');
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  }
  const response = await realFetch(input, { ...init, headers });
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';'); const at = pair.indexOf('=');
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return response;
};

const { createAuthClient } = await import('@neondatabase/auth');
function load(path, stubs) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => (name in stubs ? stubs[name] : require(name)), window: { addEventListener() {} }, fetch: globalThis.fetch, Headers, Response, URL, AbortSignal, FormData, Promise, console };
  vm.runInNewContext(out, context);
  return context.exports;
}
const env = { neonAuthUrl: creds.authUrl, apiBaseUrl: API };
let apiModule;
const auth = load('src/lib/auth.ts', { '@neondatabase/auth': { createAuthClient }, './env': { env }, react: React });
apiModule = load('src/lib/api.ts', { './env': { env }, './auth': auth, '../types/orders': {} });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

check('signed out: no token', (await auth.getAccessToken()) === null);
const signIn = await auth.authClient.signIn.email({ email: creds.email, password: creds.password });
check('SDK sign-in succeeds', !signIn.error, signIn.error?.message);
const token = await auth.getAccessToken();
check('getAccessToken returns a JWT right after sign-in', typeof token === 'string' && token.split('.').length === 3, String(token).slice(0, 20));
const me = await realFetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
check('the local API accepts that token', me.status === 200, `HTTP ${me.status}`);
const viaApi = await apiModule.apiFetch('/api/me');
check('apiFetch sends it automatically', viaApi?.role === 'CUSTOMER', JSON.stringify(viaApi).slice(0, 80));
await auth.refreshSession();
check('token still available after refreshSession', typeof (await auth.getAccessToken()) === 'string');
await auth.signOut();
check('signed out again: no token', (await auth.getAccessToken()) === null);
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
