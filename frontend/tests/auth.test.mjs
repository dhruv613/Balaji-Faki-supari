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
let codeFailure = null;
const sdk = {
  signIn: { email: async payload => { history.push({ method: 'signIn.email', payload }); return failure ? { data: null, error: failure } : { data: { user: { id: 'u' } }, error: null }; } },
  signUp: { email: async payload => { history.push({ method: 'signUp.email', payload }); return failure ? { data: null, error: failure } : { data: { user: { id: 'new-user' } }, error: null }; } },
  emailOtp: {
    verifyEmail: async payload => { history.push({ method: 'emailOtp.verifyEmail', payload }); return codeFailure ? { data: null, error: codeFailure } : { data: { status: true }, error: null }; },
    sendVerificationOtp: async payload => { history.push({ method: 'emailOtp.sendVerificationOtp', payload }); return { data: { success: true }, error: null }; },
    resetPassword: async payload => { history.push({ method: 'emailOtp.resetPassword', payload }); return codeFailure ? { data: null, error: codeFailure } : { data: { success: true }, error: null }; },
  },
};
const emailModule = load('src/components/common/EmailSignIn.tsx', {
  react: hookReact,
  '../../lib/auth': { authClient: sdk, refreshSession: async () => { history.push({ method: 'refreshSession' }); } },
  '../../lib/profile': { updateProfile: async details => { history.push({ method: 'updateProfile', payload: details }); } },
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
const reset = () => { hooks = []; cursor = 0; history.length = 0; failure = null; codeFailure = null; };

// Sign in: exactly one sign-in call, normalised email, password cleared afterwards.
reset();
change('login-email', ' Customer@Example.test '); change('login-password', 'unit-test-only');
await submit();
assert.deepEqual(history.map(h => h.method), ['signIn.email', 'refreshSession']);
assert.equal(history[0].payload.email, 'customer@example.test');
assert.equal(field(render(), 'login-password').props.value, '');

// A wrong password or mistyped email NEVER creates an account; the customer is offered Create account instead.
reset();
failure = { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 };
change('login-email', 'typo@example.test'); change('login-password', 'whatever123');
await submit();
assert.deepEqual(history.map(h => h.method), ['signIn.email'], 'a failed login must not call signUp');
assert.match(html(), /email or password is incorrect/i);
assert.match(html(), /Create an account with this email/);
press('Create an account with this email');
assert.match(html(), /Create your account/);
assert.equal(field(render(), 'login-email').props.value, 'typo@example.test', 'typed email is kept when switching');
assert.deepEqual(history.map(h => h.method), ['signIn.email']);

// A deployment-origin rejection is a site configuration failure, never an invitation to create another account.
for (const cause of [{ message: 'Invalid origin', code: 'INVALID_ORIGIN', status: 403 }, new Error('Invalid origin')]) {
  reset();
  failure = cause;
  change('login-email', 'a@example.test'); change('login-password', 'password1');
  await submit();
  assert.match(html(), /Sign-in is unavailable at this website address/);
  assert.match(html(), /main website or contact the store/);
  assert.doesNotMatch(html(), /Create an account with this email/);
  assert.deepEqual(history.map(h => h.method), ['signIn.email']);
}

// Network and rate-limit failures are explained, not treated as "new customer".
reset();
failure = new Error('Failed to fetch');
change('login-email', 'a@example.test'); change('login-password', 'password1');
await submit();
assert.match(html(), /could not reach the sign-in service/i);
assert.deepEqual(history.map(h => h.method), ['signIn.email']);

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
assert.deepEqual(history.map(h => h.method), ['signUp.email']);
assert.equal(JSON.stringify(history[0].payload), JSON.stringify({ email: 'new@example.test', password: 'long-enough-1', name: 'હેતલ પટેલ' }));
assert.ok(!('role' in history[0].payload), 'no role or privilege data is ever sent');
assert.match(html(), /Verify your email/, 'a new account must verify its email before it is signed in');
codeFailure = { message: 'Invalid OTP' };
change('email-verification-code', '000000');
await submit();
assert.match(html(), /Invalid OTP/);
assert.ok(!history.some(h => h.method === 'updateProfile'), 'a wrong code never signs in or saves the profile');
codeFailure = null;
history.length = 0;
change('email-verification-code', ' 123456 ');
await submit();
assert.deepEqual(history.map(h => h.method), ['emailOtp.verifyEmail', 'signIn.email', 'refreshSession', 'updateProfile']);
assert.equal(history[0].payload.otp, '123456');
assert.equal(JSON.stringify(history[3].payload), JSON.stringify({ fullName: 'હેતલ પટેલ', phone: '+919876543210' }));
assert.doesNotMatch(html(), /Verify your email/);

// A new code can be requested for the same address.
reset();
press('Create account');
change('register-name', 'Test Customer'); field(render(), 'register-phone').props.onChange('9876543210');
change('login-email', 'c@example.test'); change('register-email-confirm', 'c@example.test'); change('login-password', 'long-enough-1');
await submit();
press('Send a new code');
await Promise.resolve();
assert.equal(JSON.stringify(history.at(-1)), JSON.stringify({ method: 'emailOtp.sendVerificationOtp', payload: { email: 'c@example.test', type: 'email-verification' } }));

// Duplicate email points to Sign in, never to a second account.
reset();
failure = { message: 'User already exists. Use another email.', code: 'USER_ALREADY_EXISTS', status: 422 };
press('Create account');
change('register-name', 'Test Customer'); field(render(), 'register-phone').props.onChange('9876543210');
change('login-email', 'dup@example.test'); change('register-email-confirm', 'dup@example.test'); change('login-password', 'long-enough-1');
await submit();
assert.match(html(), /account already exists/i);
assert.match(html(), /Go to sign in/);

// Forgot password: a code by email, then a new password (8+ characters), then sign-in. Works for the Owner Admin too.
reset();
assert.match(html({ signInOnly: true }), /Forgot password\?/);
press('Forgot password?');
assert.match(html(), /Reset your password/);
change('login-email', ' Owner@Example.test ');
await submit();
assert.equal(JSON.stringify(history), JSON.stringify([{ method: 'emailOtp.sendVerificationOtp', payload: { email: 'owner@example.test', type: 'forget-password' } }]));
assert.match(html(), /If owner@example\.test has an account, a reset code has been sent/, 'the reply never reveals whether the account exists');
change('reset-code', ' 654321 '); change('login-password', 'short');
await submit();
assert.match(html(), /at least 8 characters/);
assert.equal(history.length, 1, 'a too-short password is not sent');
change('login-password', 'new-password-1');
await submit();
assert.deepEqual(history.map(h => h.method), ['emailOtp.sendVerificationOtp', 'emailOtp.resetPassword', 'signIn.email', 'refreshSession']);
assert.equal(JSON.stringify(history[1].payload), JSON.stringify({ email: 'owner@example.test', otp: '654321', password: 'new-password-1' }));
assert.doesNotMatch(html(), /Reset your password/);

// Owner Admin sign-in never offers account creation.
reset();
assert.doesNotMatch(html({ signInOnly: true }), /Create account/);

// Failure classification is stable.
const { describeAuthFailure } = emailModule;
assert.equal(describeAuthFailure({ message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }, 'signin').suggest, 'register');
assert.equal(describeAuthFailure({ message: 'User already exists', code: 'USER_ALREADY_EXISTS' }, 'register').suggest, 'signin');
assert.match(describeAuthFailure({ message: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' }, 'signin').message, /Verify your email/);
assert.match(describeAuthFailure({ status: 429, message: '' }, 'signin').message, /Too many attempts/);
assert.equal(describeAuthFailure({ code: 'ORIGIN_NOT_ALLOWED' }, 'register').suggest, undefined);
assert.match(describeAuthFailure({ message: 'Unable to send email. Try again later.' }, 'signin').message, /Unable to send email/);

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

// Neon Auth tokens: only a signed-in user with a VERIFIED email gets an API token; the role always comes from the API.
let neonSession = null;
let sessionCalls = 0;
// Shaped like the real SDK: the JWT rides on the cached session (`session.token`); `token()` is answered from that
// same cache without a token, so the app must not depend on it.
const neonClient = {
  getSession: async () => { sessionCalls++; return { data: neonSession, error: null }; },
  token: async () => ({ data: { session: neonSession?.session, user: neonSession?.user }, error: null }),
  signOut: async () => ({ error: null }),
};
const authModule = load('src/lib/auth.ts', {
  '@neondatabase/auth': { createAuthClient: () => neonClient },
  './env': { env: { neonAuthUrl: 'https://auth.example.test/neondb/auth', apiBaseUrl: '' } },
  react: React,
}, { window: { addEventListener() {}, alert() {} } });
assert.equal(await authModule.getAccessToken(), null, 'signed out: no token');
neonSession = { user: { id: 'n1', email: 'a@example.test', emailVerified: false }, session: { token: 'header.payload.signature' } };
assert.equal(await authModule.getAccessToken(), null, 'an unverified email never receives an API token');
neonSession = { user: { id: 'n1', email: 'a@example.test', emailVerified: true }, session: { token: 'header.payload.signature' } };
assert.equal(await authModule.getAccessToken(), 'header.payload.signature', 'the JWT comes from the session, not token()');
neonSession = { user: { id: 'n1', email: 'a@example.test', emailVerified: true }, session: { token: 'opaque-session-id' } };
assert.equal(await authModule.getAccessToken(), null, 'an opaque session id is never sent as a JWT');
neonClient.getSession = async () => { sessionCalls++; throw new TypeError('Failed to fetch'); };
assert.equal(await authModule.getAccessToken(), null, 'a sign-in service outage does not break public API calls');
neonClient.getSession = async () => { sessionCalls++; return { data: null, error: null }; };
await authModule.refreshSession();
const before = sessionCalls;
assert.equal(await authModule.getAccessToken(), null);
assert.equal(sessionCalls, before, 'known guests browse without a round trip to the sign-in service');
const authSource = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');
assert.doesNotMatch(authSource, /role\s*[:=]\s*user\./, 'the role is never read from the browser session');
assert.throws(() => readFileSync(new URL('../src/lib/supabase.ts', import.meta.url)), /ENOENT/, 'the Supabase client is gone');

if (process.argv.includes('--fixtures')) {
  mkdirSync(new URL('../../docs/testing/verification/fixtures/',import.meta.url),{recursive:true});
  for (const [name,props] of [['login',{}],['register',{initialMode:'register'}]]) {
    cursor = 0; hooks = [];
    writeFileSync(new URL(`../../docs/testing/verification/fixtures/${name}.html`,import.meta.url),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="/src/styles/globals.css" rel="stylesheet"></head><body><aside class="notice">STATIC AUTH DESIGN FIXTURE - No account exists. Controls are inactive.</aside>${html(props)}</body></html>`);
  }
}
console.log('Authentication: explicit sign in and create account (no silent sign-up), validation, local registration, duplicate and failure handling, safe redirects, public store, email verification before sign-in, password reset by emailed code, and verified-only Neon Auth tokens passed.');
