import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const require = createRequire(import.meta.url);
function load(path, stubs = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, URL, FormData, Headers, AbortSignal, crypto, ...globals, require: name => name in stubs ? stubs[name] : require(name) };
  vm.runInNewContext(compiled, context, { filename: path });
  return context.exports;
}
let fakeFetch;
let session = null;
const env = { apiBaseUrl: '', supportWhatsApp: '918000961030' };
const auth = { supabase: { auth: { getSession: async () => ({ data: { session } }) } }, useSession: () => ({ session: { user: { id: 'ui-test-user' } }, loading: false }) };
const api = load('src/lib/api.ts', { './env': { env }, './supabase': auth }, { fetch: (...args) => fakeFetch(...args) });
const contracts = load('src/lib/contracts.ts');
const ordersApi = load('src/features/orders/api/ordersApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const paymentsApi = load('src/features/payments/api/paymentsApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const catalogApi = load('src/features/catalog/api/catalogApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const customer = load('src/lib/customer.ts');
const mobileInput = load('src/components/common/MobileNumberInput.tsx', { '../../lib/customer': customer }).default;
const storage = new Map();
const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) };
const context = load('src/context/OrderContext.tsx', {
  '../lib/api': api, '../features/catalog/api/catalogApi': catalogApi,
  '../features/orders/api/ordersApi': ordersApi, '../lib/customer': customer,
}, { sessionStorage });
const { initialState, reducer, restoreDraft, validateForm, buildSummary, toOrderFormData } = context;
const valid = { ...initialState, product: 'faki', packSize: '500g', quantity: 2, fullName: '  હેતલ પટેલ  ', phone: '+91 98765 43210', address: 'Riddhi Siddhi Complex, Rajkot', pinCode: '360005' };
assert.equal(Object.keys(validateForm(valid)).length, 0);
for (const input of [{quantity:0}, {quantity:NaN}, {quantity:1.5}, {quantity:21}, {product:'other'}, {packSize:'2kg'}, {phone:'1234'}, {phone:'5876543210'}, {pinCode:'000000'}, {pinCode:'12345'}, {fullName:' '}, {address:'short'}]) {
  assert.ok(Object.keys(validateForm({...valid, ...input})).length, JSON.stringify(input));
}
assert.equal(toOrderFormData(valid).fullName, 'હેતલ પટેલ');
assert.equal(toOrderFormData(valid).phone, '+919876543210');
assert.equal(customer.normalizeIndianMobile('+91 (98765) 43210'), '9876543210');
assert.equal(customer.normalizeIndianMobile('09876543210'), '9876543210');
for (const phone of ['987654321', '98765432100', '5876543210', '9876abc210', '+449876543210', '++919876543210']) {
  assert.ok(customer.validateCustomerDetails({ fullName:'Customer', phone }).phone, phone);
}
assert.equal(customer.validateCustomerDetails({fullName:'કિરણ પટેલ',phone:'6987654321'}).phone,undefined);
assert.ok(customer.validateCustomerDetails({fullName:'A'.repeat(101),phone:'9876543210'}).fullName);
storage.set('bfp-order-session', JSON.stringify(valid));
context.persistDraft(valid, 'customer-one');
assert.equal(storage.has('bfp-order-session'),false,'Remove legacy unowned drafts');
const userOne={id:'customer-one',user_metadata:{fullName:'First Customer',phone:'+919876543210'}};
const userTwo={id:'customer-two',user_metadata:{fullName:'Second Customer',phone:'+916987654321'}};
assert.equal(context.loadState(userOne).address,valid.address);
assert.equal(context.loadState(userOne).phone,'9876543210');
assert.equal(context.loadState(userTwo).address,'','No cross-account draft disclosure');
assert.equal(context.loadState(userTwo).orderId,'');
assert.equal(context.loadState(userTwo).fullName,'Second Customer');
assert.equal(context.loadState(userTwo).phone,'6987654321');
let enteredMobile=''; let inputValidity='';
const mobileElement=mobileInput({value:'',onChange:value=>{enteredMobile=value;}}).props.children[1];
assert.equal(mobileElement.props.maxLength,10);
mobileElement.props.onChange({target:{value:'98x765432100'},currentTarget:{setCustomValidity:message=>{inputValidity=message;}}});
assert.equal(enteredMobile,'9876543210');
const pasteMobile=value=>mobileElement.props.onPaste({preventDefault(){},clipboardData:{getData:()=>value},currentTarget:{setCustomValidity:message=>{inputValidity=message;},reportValidity(){}}});
pasteMobile('+91 69876 54321'); assert.equal(enteredMobile,'6987654321');
pasteMobile('9876543210123'); assert.ok(inputValidity); assert.equal(enteredMobile,'6987654321','Do not silently truncate an overlong pasted number');
const proof = {...valid, orderId:'old', serverOrder:{id:'old'}, paymentStatus:'verified', utrNumber:'412345678912', screenshotFile:{}, screenshotPreview:'blob:old', checkoutKey:'old-key'};
for (const action of [{type:'SET_PRODUCT',payload:'supari'}, {type:'SET_PACK_SIZE',payload:'1kg'}, {type:'SET_QUANTITY',payload:3}, {type:'SET_FIELD',payload:{field:'address',value:'Another address'}}]) {
  const next = reducer(proof, action);
  assert.equal(next.orderId, ''); assert.equal(next.serverOrder, null); assert.equal(next.paymentStatus, null);
  assert.equal(next.utrNumber, ''); assert.equal(next.screenshotFile, null); assert.equal(next.screenshotPreview, ''); assert.equal(next.checkoutKey, '');
}
assert.equal(reducer(valid,{type:'SET_QUANTITY',payload:99}).quantity,20);
assert.equal(reducer(valid,{type:'SET_QUANTITY',payload:NaN}).quantity,2);
const saved = restoreDraft(JSON.stringify(proof));
assert.equal(saved.serverOrder,null); assert.equal(saved.paymentStatus,null); assert.equal(saved.utrNumber,'');
assert.equal(saved.checkoutKey,'old-key'); assert.equal(saved.orderId,'old');
assert.equal(restoreDraft('{').product,'faki');
assert.equal(restoreDraft(JSON.stringify({product:'invalid',quantity:'bad',fullName:5})).product,'faki');
assert.equal(buildSummary(initialState).total,null);
assert.equal(api.formatINR(0),'₹0'); assert.equal(api.formatINR(null),'Awaiting price');
assert.equal(paymentsApi.validateUtr('412345678912'),null);
assert.ok(paymentsApi.validateUtr('123'));
assert.ok(paymentsApi.validateScreenshot(null));
assert.ok(paymentsApi.validateScreenshot({type:'image/svg+xml',size:5}));
assert.ok(paymentsApi.validateScreenshot({type:'image/png',size:0}));
assert.ok(paymentsApi.validateScreenshot({type:'image/png',size:6*1024*1024}));
assert.equal(paymentsApi.validateScreenshot({type:'image/png',size:128}),null);
assert.equal(paymentsApi.maskUtr('412345678912'),'4XXXXXXXX912');
for (const status of ['pending_payment','verifying_payment']) assert.equal(paymentsApi.isPaymentConfirmed({status:'verified',orderStatus:status}),false);
assert.equal(paymentsApi.isPaymentConfirmed({status:'verified',orderStatus:'active'}),true);
assert.equal(paymentsApi.isPaymentConfirmed({status:'verifying',orderStatus:'active'}),false);
assert.throws(() => contracts.readQuote({subtotal:100,deliveryFee:0,total:101,currency:'INR'}));
assert.throws(() => contracts.readQuote({subtotal:-1,deliveryFee:0,total:-1,currency:'INR'}));
assert.equal(contracts.readQuote({subtotal:100,deliveryFee:0,total:100,currency:'INR'}).deliveryFee,0);
assert.throws(() => contracts.readProducts([{type:'faki'}]));
assert.throws(() => contracts.readPaymentStatus({orderId:'other',orderNumber:'BFP',status:'verified',orderStatus:'active'},'mine'));
const order = {id:'UI-PREVIEW-NO-ORDER',orderNumber:'#UI-PREVIEW', product:'faki',productName:'Faki',packSize:'500g',quantity:2,subtotal:100,deliveryFee:0,total:100,customerName:'UI preview',phone:'9999999999',address:'Design preview only',pinCode:'360005',status:'pending_payment',paymentStatus:'pending',createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z',payment:{amount:100,payeeName:'Design preview — do not pay',upiId:'Not issued'}};
assert.equal(contracts.readOrder(order).id,order.id);
assert.throws(() => contracts.readOrder({...order,utrNumber:{bad:true}}));
assert.throws(() => contracts.readPaymentStatus({orderId:'mine',orderNumber:'BFP',status:'verified',orderStatus:'active',utrMasked:{}},'mine'));
assert.throws(() => contracts.readTracking({events:[{label:'Packed'}]}));
assert.throws(() => contracts.readQuote({subtotal:100.001,deliveryFee:0,total:100.001,currency:'INR'}));
assert.throws(() => contracts.readOrder({...order,payment:{...order.payment,amount:999}}));
assert.throws(() => contracts.readOrder({...order,payment:{...order.payment,qrImageUrl:'javascript:alert(1)'}}));
await assert.rejects(api.apiFetch('/products'),/not connected/);
env.apiBaseUrl='https://example.test/api';
session={access_token:'test-only-token'};
let request;
fakeFetch=async (url,options) => {request={url,options};return new Response(JSON.stringify(order),{status:200});};
await ordersApi.createOrder(toOrderFormData(valid),'persisted-key');
assert.equal(request.options.headers.get('Authorization'),'Bearer test-only-token');
assert.equal(request.options.headers.get('Idempotency-Key'),'persisted-key');
assert.equal(request.url,'https://example.test/api/orders');
assert.ok(!('total' in JSON.parse(request.options.body)), 'Client must not submit trusted payable totals');
fakeFetch=async (url,options) => {request={url,options};return new Response(JSON.stringify({paymentStatus:'verifying',message:'Received'}),{status:200});};
await paymentsApi.submitPayment(order.id,{utrNumber:'412345678912',screenshot:new File(['image'],'proof.png',{type:'image/png'})});
assert.equal(request.options.headers.get('Content-Type'),null,'Browser sets multipart boundary');
assert.equal(request.options.body.get('utr'),'412345678912');
fakeFetch=async () => new Response(JSON.stringify({detail:[{msg:'PIN not served'}]}),{status:422});
await assert.rejects(api.apiFetch('/test'),/PIN not served/);
fakeFetch=async () => {throw new TypeError('network')};
await assert.rejects(api.apiFetch('/test'),/Cannot reach/);
fakeFetch=async () => new Response('<html>bad gateway</html>',{status:200});
await assert.rejects(api.apiFetch('/test'),/unreadable/);

// Actual React components rendered with explicitly isolated design-only data; never imported by src.
if (process.argv.includes('--fixtures')) {
  mkdirSync(new URL('../verification/fixtures/',import.meta.url),{recursive:true});
  const notice=load('src/components/common/Notice.tsx').default;
  const stepper=load('src/components/common/OrderStepper.tsx').default;
  const noOrder=load('src/components/common/NoActiveOrder.tsx',{'react-router-dom':require('react-router-dom')}).default;
  for (const [name,path,state] of [
    ['order','orders/pages/OrderFormPage.tsx',{...initialState,packSize:'500g',quantity:2}],
    ['review','orders/pages/ReviewOrderPage.tsx',valid],
    ['payment','payments/pages/QRPaymentPage.tsx',{...valid,serverOrder:order,orderId:order.id,orderNumber:order.orderNumber,paymentStatus:'pending'}],
    ['verification','payments/pages/PaymentVerificationPage.tsx',{...valid,serverOrder:order,orderId:order.id,orderNumber:order.orderNumber,paymentStatus:'verifying',utrNumber:'412345678912'}],
  ]) {
    const mockContext={...context,useOrder:()=>state,useOrderDispatch:()=>()=>{}};
    const component=load(`src/features/${path}`,{
      '../../../context/OrderContext':mockContext,'../../../lib/api':{...api,formatINR:()=> '₹[TOTAL]'},
      '../../../lib/supabase':auth,'../../../lib/env':{env},
      '../../../components/common/OrderStepper':{default:stepper},'../../../components/common/Notice':{default:notice},
      '../../../components/common/NoActiveOrder':{default:noOrder},'../../../components/common/EmailSignIn':{default:()=>null},
      '../../../components/common/MobileNumberInput':{default:mobileInput},
      '../api/ordersApi':ordersApi,'../api/paymentsApi':paymentsApi,
    }).default;
    const markup=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(component)));
    if(name==='payment') assert.ok(!markup.includes('Pay within'),'No fabricated payment expiry');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Gloock&family=Hind+Vadodara:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/src/styles/globals.css"></head><body><aside class="notice">DESIGN TEST FIXTURE · No order exists. Do not pay. Controls are static.</aside><header class="header"><div class="wrapper"><img src="/images/balaji-logo.png" height="56" width="109" alt="Balaji Faki Point"><nav class="nav">Home　Order　My Orders　Track　Reviews　Visit Store　Help</nav></div></header><main class="page">${markup}</main></body></html>`;
    writeFileSync(new URL(`../verification/fixtures/${name}.html`,import.meta.url),html);
  }
}
console.log('Core checkout: validation, draft persistence, payment reset, server contracts, bearer auth, idempotency, upload validation and failure handling passed.');
