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
let authState = { session: null, loading: true };
let authFailure = null;
let signupSession = null;
let call;
const sdk = { auth: {
  signInWithPassword: async payload => { call = {method:'signInWithPassword',payload}; return {data:{session:{}},error:authFailure}; },
  signUp: async payload => { call = {method:'signUp',payload}; return {data:{session:signupSession},error:authFailure}; },
  updateUser: async payload => { call = {method:'updateUser',payload}; return {error:authFailure}; },
  signOut: async () => { call = {method:'signOut'}; return {error:authFailure}; },
} };
const auth = { supabase:sdk, useSession:()=>authState };
const email = load('src/components/common/EmailSignIn.tsx', { '../../lib/supabase':auth, './Notice':{default:notice} }).default;
const gateStubs = { '../../lib/supabase':auth, '../../lib/customer':customer, './EmailSignIn':{default:email}, './MobileNumberInput':{default:mobile}, './Notice':{default:notice} };
const Gate = load('src/components/common/AuthGate.tsx', gateStubs).default;
const renderGate = () => renderToStaticMarkup(React.createElement(Gate, {children:()=>React.createElement('p',null,'PRIVATE STORE CONTENT')}));
assert.match(renderGate(),/Checking your sign-in/);
assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/);
authState.loading=false;
assert.match(renderGate(),/login-email/); assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/);
authState.session={user:{id:'unit-user',email:'test@example.test',user_metadata:{}}};
assert.match(renderGate(),/Your details/); assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/);
authState.session.user.user_metadata={fullName:'Test Customer',phone:'+915876543210'};
assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/);
authState.session.user.user_metadata={fullName:'Test Customer',phone:'+919876543210'};
assert.match(renderGate(),/PRIVATE STORE CONTENT/);
authState.session=null;
assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/,'Sign-out locks the store again');

// Isolated component handlers use a tiny hook harness; no real credentials or auth network requests.
let hooks=[]; let cursor=0;
const hookReact={...React,useState:initial=>{
  const index=cursor++;
  if (!(index in hooks)) hooks[index]=typeof initial==='function'?initial():initial;
  return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];
}};
const SignIn=load('src/components/common/EmailSignIn.tsx',{'react':hookReact,'../../lib/supabase':auth,'./Notice':{default:notice}}).default;
function render(Component,props={}) { cursor=0; return Component(props); }
function change(tree,id,value) { control(tree,node=>node.props.id===id).props.onChange({target:{value}}); }
async function submit(tree) { await control(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}}); }
let tree=render(SignIn);
change(tree,'login-email',' customer@example.test '); change(tree,'login-password','unit-test-only');
await submit(render(SignIn));
assert.equal(call.method,'signInWithPassword'); assert.equal(call.payload.email,'customer@example.test');
assert.equal(call.payload.password,'unit-test-only');
assert.equal(control(render(SignIn),node=>node.props.id==='login-password').props.value,'');
control(render(SignIn),node=>node.type==='button'&&node.props.type==='button').props.onClick();
tree=render(SignIn); change(tree,'login-password','unit-signup-only');
await submit(render(SignIn));
assert.equal(call.method,'signUp');
assert.match(renderToStaticMarkup(render(SignIn)),/Check your email for a confirmation link/,'No false login after confirmation-required signup');
authFailure=new Error('Invalid login credentials');
change(render(SignIn),'login-password','wrong-unit-password');
await submit(render(SignIn));
assert.match(renderToStaticMarkup(render(SignIn)),/Invalid login credentials/);

let focused=''; hooks=[]; authFailure=null;
authState.session={user:{id:'unit-user',email:'test@example.test',user_metadata:{}}};
const InteractiveGate=load('src/components/common/AuthGate.tsx',{...gateStubs,'react':hookReact},{document:{getElementById:id=>({focus(){focused=id;}})}}).default;
const profile=control(InteractiveGate({children:()=>null}),node=>typeof node.type==='function'&&node.type.name==='CompleteProfile');
tree=render(profile.type,profile.props); call=null;
await submit(tree); assert.equal(call,null); assert.equal(focused,'profile-name');
tree=render(profile.type,profile.props); change(tree,'profile-name','  હેતલ પટેલ  ');
control(render(profile.type,profile.props),node=>node.props.id==='profile-phone').props.onChange('5876543210');
await submit(render(profile.type,profile.props)); assert.equal(call,null); assert.equal(focused,'profile-phone');
control(render(profile.type,profile.props),node=>node.props.id==='profile-phone').props.onChange('9876543210');
await submit(render(profile.type,profile.props));
assert.equal(call.method,'updateUser'); assert.equal(call.payload.data.fullName,'હેતલ પટેલ');
assert.equal(call.payload.data.phone,'+919876543210');
authFailure=new Error('Unable to reach authentication service');
await submit(render(profile.type,profile.props));
assert.match(renderToStaticMarkup(render(profile.type,profile.props)),/Unable to reach authentication service/);
assert.doesNotMatch(renderGate(),/PRIVATE STORE CONTENT/,'Failed profile save cannot unlock store');

if (process.argv.includes('--fixtures')) {
  mkdirSync(new URL('../verification/fixtures/',import.meta.url),{recursive:true});
  for (const [name,session] of [['login',null],['profile',{user:{id:'unit-user',email:'design-preview@example.test',user_metadata:{}}}]]) {
    authState={session,loading:false};
    writeFileSync(new URL(`../verification/fixtures/${name}.html`,import.meta.url),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Gloock&family=Hind+Vadodara:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/src/styles/globals.css"></head><body><aside class="notice">STATIC AUTH DESIGN FIXTURE · No account exists. Controls are inactive.</aside>${renderGate()}</body></html>`);
  }
}
console.log('Authentication: session/profile gates, password login, email confirmation, invalid mobile rejection, profile save errors and sign-out passed (isolated SDK tests).');
