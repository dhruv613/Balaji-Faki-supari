import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(path, stubs = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, Error, ...globals, require: name => name in stubs ? stubs[name] : require(name) };
  vm.runInNewContext(compiled, context, { filename: path });
  return context.exports;
}
function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function control(tree, predicate) { return elements(tree).find(predicate); }

const customer = load('src/lib/customer.ts');
const notice = load('src/components/common/Notice.tsx').default;
const mobile = load('src/components/common/MobileNumberInput.tsx', { '../../lib/customer': customer }).default;
// ---- Explicit Sign in / Create account (no silent sign-up) -----------------------------------------
let hooks = []; let cursor = 0;
const hookReact = { ...React, useState: initial => {
  const index = cursor++;
  if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
  return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
} };
const history = [];
let failure = null;
let registerSession = { user: { id: 'new-user' } };
const sdk = { auth: {
  signInWithPassword: async payload => { history.push({ method: 'signInWithPassword', payload }); return failure ? { data: { session: null }, error: failure } : { data: { session: { user: { id: 'u' } } }, error: null }; },
  signUp: async (payload, profile) => { history.push({ method: 'signUp', payload, profile }); return failure ? { data: { session: null }, error: failure } : { data: { session: registerSession }, error: null }; },
} };
const emailModule = load('src/components/common/EmailSignIn.tsx', {
  react: hookReact,
  '../../lib/supabase': { supabase: sdk },
  '../../lib/customer': customer,
  './MobileNumberInput': { default: mobile },
  './Notice': { default: notice },
});
const SignIn = emailModule.default;
const render = (props = {}) => { cursor = 0; return SignIn(props); };
const html = (props = {}) => renderToStaticMarkup(render(props));
const field = (tree, id) => control(tree, node => node.props.id === id);
const change = (id, value) => field(render(), id).props.onChange({ target: { value } });
const press = (label) => control(render(), node => node.type === 'button' && (node.props.children === label || (Array.isArray(node.props.children) && node.props.children.includes(label)))).props.onClick();
const submit = async () => { await control(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }); };
const reset = () => { hooks = []; cursor = 0; history.length = 0; failure = null; registerSession = { user: { id: 'new-user' } }; };

// Sign in: exactly one sign-in call, normalised email, password cleared afterwards.
reset();
change('login-email', ' Customer@Example.test '); change('login-password', 'unit-test-only');
await submit();
assert.deepEqual(history.map(h => h.method), ['signInWithPassword']);
assert.equal(history[0].payload.email, 'customer@example.test');
assert.equal(field(render(), 'login-password').props.value, '');

// A wrong password or mistyped email NEVER creates an account; the customer is offered Create account instead.
reset();
failure = new Error('Invalid login credentials');
change('login-email', 'typo@example.test'); change('login-password', 'whatever123');
await submit();
assert.deepEqual(history.map(h => h.method), ['signInWithPassword'], 'a failed login must not call signUp');
assert.match(html(), /email or password is incorrect/i);
assert.match(html(), /Create an account with this email/);
press('Create an account with this email');
assert.match(html(), /Create your account/);
assert.equal(field(render(), 'login-email').props.value, 'typo@example.test', 'typed email is kept when switching');
assert.deepEqual(history.map(h => h.method), ['signInWithPassword']);

// Network and rate-limit failures are explained, not treated as "new customer".
reset();
failure = new Error('Failed to fetch');
change('login-email', 'a@example.test'); change('login-password', 'password1');
await submit();
assert.match(html(), /could not reach the sign-in service/i);
assert.deepEqual(history.map(h => h.method), ['signInWithPassword']);

// Create account: validation first, then one signUp carrying only name and phone metadata.
reset();
press('Create account');
change('login-email', 'new@example.test'); change('register-email-confirm', 'other@example.test');
change('login-password', 'short');
change('register-name', 'A'); field(render(), 'register-phone').props.onChange('5876543210');
await submit();
assert.equal(history.length, 0, 'invalid registration is not sent');
const invalidMarkup = html();
assert.match(invalidMarkup, /two email addresses do not match/);
assert.match(invalidMarkup, /Use at least 8 characters/);
assert.match(invalidMarkup, /full name/i);
assert.match(invalidMarkup, /10-digit Indian mobile/);
change('register-name', '  હેતલ પટેલ  '); field(render(), 'register-phone').props.onChange('9876543210');
change('register-email-confirm', ' NEW@example.test '); change('login-password', 'long-enough-1');
await submit();
assert.deepEqual(history.map(h => h.method), ['signUp']);
assert.equal(history[0].payload.email, 'new@example.test');
assert.equal(JSON.stringify(history[0].profile), JSON.stringify({ fullName: 'હેતલ પટેલ', phone: '+919876543210' }));
assert.ok(!('role' in history[0].profile) && !('role' in history[0].payload), 'no role or privilege data is ever sent');
assert.doesNotMatch(html(), /confirmation link/, 'local sign-up starts a session immediately');

// If a deployment requires email confirmation, the customer is told so and is NOT shown as signed in.
reset();
registerSession = null;
press('Create account');
change('register-name', 'Test Customer'); field(render(), 'register-phone').props.onChange('9876543210');
change('login-email', 'c@example.test'); change('register-email-confirm', 'c@example.test'); change('login-password', 'long-enough-1');
await submit();
assert.match(html(), /Check your email for a confirmation link/);

// Duplicate email points to Sign in, never to a second account.
reset();
failure = new Error('User already registered');
press('Create account');
change('register-name', 'Test Customer'); field(render(), 'register-phone').props.onChange('9876543210');
change('login-email', 'dup@example.test'); change('register-email-confirm', 'dup@example.test'); change('login-password', 'long-enough-1');
await submit();
assert.match(html(), /account already exists/i);
assert.match(html(), /Go to sign in/);

// Owner Admin sign-in never offers account creation.
reset();
assert.doesNotMatch(html({ signInOnly: true }), /Create account/);

// Failure classification is stable.
const { describeAuthFailure } = emailModule;
assert.equal(describeAuthFailure(new Error('Invalid login credentials'), 'signin').suggest, 'register');
assert.equal(describeAuthFailure(new Error('User already registered'), 'register').suggest, 'signin');
assert.match(describeAuthFailure({ status: 429, message: '' }, 'signin').message, /Too many attempts/);

// Post-login destinations must be same-site paths.
const { safeNextPath } = load('src/lib/navigation.ts');
assert.equal(safeNextPath('/order/review'), '/order/review');
for (const hostile of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/javascript:alert(1)', '', null, undefined]) {
  assert.equal(safeNextPath(hostile), '/', String(hostile));
}

// The whole store is public: the app shell no longer hides pages behind a login wall.
const appSource = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(appSource, /AuthGate/, 'browsing must not require authentication');
assert.throws(() => readFileSync(new URL('../src/components/common/AuthGate.tsx', import.meta.url)), /ENOENT/);

// Phase 2 Security Assertions: Verify synthetic session code is removed and JWT validation rejects forged/anon tokens
const supabaseSource = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8');
assert.doesNotMatch(supabaseSource, /buildSessionFromDbUser/, 'Synthetic session builder must be removed');
assert.doesNotMatch(supabaseSource, /simple_auth_login/, 'Direct DB login RPC must not be called');
assert.doesNotMatch(supabaseSource, /simple_auth_update_profile/, 'Insecure profile RPC must not be called');

const supabaseMod = load(
  'src/lib/supabase.ts',
  {
    './env': { env: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test_key' } },
    '@supabase/supabase-js': {
      createClient: () => ({
        from: () => ({}),
        rpc: async () => ({ data: null, error: null }),
        storage: {},
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          signInWithPassword: async () => ({ data: { session: null, user: null }, error: null }),
          signUp: async () => ({ data: { session: null, user: null }, error: null }),
          updateUser: async () => ({ data: { user: null }, error: null }),
          signOut: async () => ({ error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
      }),
    },
  },
  { Buffer },
);

function makeJwt(payload) {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const nowSec = Math.floor(Date.now() / 1000);
assert.equal(supabaseMod.isGenuineSupabaseUserSession(null), false);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: 'bfp-session-unit-user',
    user: { id: 'unit-user' },
  }),
  false,
  'Synthetic session string must be rejected',
);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: 'sb_publishable_test_key',
    user: { id: 'unit-user' },
  }),
  false,
  'Publishable anon key must be rejected as user session token',
);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: makeJwt({ role: 'anon', exp: nowSec + 3600 }),
    user: { id: 'unit-user' },
  }),
  false,
  'Anon role JWT without matching user sub must be rejected',
);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: makeJwt({ sub: 'other-user', role: 'authenticated', exp: nowSec + 3600 }),
    user: { id: 'unit-user' },
  }),
  false,
  'Mismatched sub claim must be rejected',
);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: makeJwt({ sub: 'unit-user', role: 'authenticated', exp: nowSec - 60 }),
    user: { id: 'unit-user' },
  }),
  false,
  'Expired JWT must be rejected',
);
assert.equal(
  supabaseMod.isGenuineSupabaseUserSession({
    access_token: makeJwt({ sub: 'unit-user', role: 'authenticated', exp: nowSec + 3600 }),
    user: { id: 'unit-user' },
  }),
  true,
  'Genuine authenticated user JWT must be accepted',
);

const fakeLocalStorage = new Map([
  ['bfp-simple-db-session-v1', '{"user":{"id":"1"}}'],
  ['bfp-simple-db-session-v2', '{"user":{"id":"2"}}'],
]);
supabaseMod.purgeLegacySyntheticSessions({
  removeItem: key => fakeLocalStorage.delete(key),
});
assert.equal(fakeLocalStorage.size, 0, 'Legacy synthetic session keys must be purged');

if (process.argv.includes('--fixtures')) {
  mkdirSync(new URL('../../docs/testing/verification/fixtures/',import.meta.url),{recursive:true});
  for (const [name,props] of [['login',{}],['register',{initialMode:'register'}]]) {
    cursor = 0; hooks = [];
    writeFileSync(new URL(`../../docs/testing/verification/fixtures/${name}.html`,import.meta.url),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/src/styles/globals.css" rel="stylesheet"></head><body><aside class="notice">STATIC AUTH DESIGN FIXTURE - No account exists. Controls are inactive.</aside>${html(props)}</body></html>`);
  }
}
console.log('Authentication: explicit sign in and create account (no silent sign-up), validation, local registration, duplicate and failure handling, safe redirects, public store, genuine Supabase JWT validation and synthetic token rejection passed.');
