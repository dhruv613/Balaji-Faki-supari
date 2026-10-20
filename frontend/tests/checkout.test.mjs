import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
const auth = { getAccessToken: async () => session?.access_token ?? null, useSession: () => ({ session: { user: { id: 'ui-test-user' } }, loading: false }) };
const api = load('src/lib/api.ts', { './env': { env }, './auth': auth }, { fetch: (...args) => fakeFetch(...args) });
const store = load('src/constants/store.ts');
const contracts = load('src/lib/contracts.ts', { '../constants/store': store });
const ordersApi = load('src/features/orders/api/ordersApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const paymentsApi = load('src/features/payments/api/paymentsApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const catalogApi = load('src/features/catalog/api/catalogApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const customer = load('src/lib/customer.ts');
const amount = load('src/lib/amount.ts');
const mobileInput = load('src/components/common/MobileNumberInput.tsx', { '../../lib/customer': customer }).default;
const storage = new Map();
const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) };
const context = load('src/context/OrderContext.tsx', {
  '../lib/api': api, '../constants/store': store, '../features/catalog/api/catalogApi': catalogApi,
  '../features/orders/api/ordersApi': ordersApi, '../lib/customer': customer, '../lib/amount': amount,
}, { sessionStorage });
const { initialState, reducer, restoreDraft, validateForm, buildSummary, toOrderFormData } = context;
const valid = { ...initialState, product: 'faki', packSize: '500g', quantity: 2, fullName: '  હેતલ પટેલ  ', phone: '+91 98765 43210', address: 'Riddhi Siddhi Complex, Rajkot', pinCode: '360005' };
assert.equal(Object.keys(validateForm(valid)).length, 0);
for (const input of [{quantity:0}, {quantity:NaN}, {quantity:1.5}, {quantity:21}, {product:'Other Product!'}, {packSize:'2 kg'}, {phone:'1234'}, {phone:'5876543210'}, {pinCode:'000000'}, {pinCode:'12345'}, {fullName:' '}, {address:'short'}]) {
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
const userOne={id:'customer-one',fullName:'First Customer',phone:'+919876543210'};
const userTwo={id:'customer-two',fullName:'Second Customer',phone:'+916987654321'};
assert.equal(context.loadState(userOne).address,valid.address);
assert.equal(context.loadState(userOne).phone,'9876543210');
assert.equal(context.loadState(userTwo).address,'','No cross-account draft disclosure');
assert.equal(context.loadState(userTwo).orderId,'');
assert.equal(context.loadState(userTwo).fullName,'Second Customer');
assert.equal(context.loadState(userTwo).phone,'6987654321');
// Visitors prepare a draft as guests; signing in keeps it and returns them to checkout.
storage.clear();
const guestDraft = { ...valid, fullName: 'Guest Visitor', phone: '9876501234', orderId: 'stale-order', checkoutKey: 'stale-key' };
context.persistDraft(guestDraft, 'guest');
assert.equal(context.loadState(null).address, valid.address, 'a guest sees their own draft');
assert.equal(context.loadState(null).fullName, 'Guest Visitor');
context.persistDraft({ ...valid, address: 'Old saved address of account one' }, 'customer-one');
const adopted = context.loadState(userOne);
assert.equal(adopted.address, valid.address, 'the draft prepared before sign-in wins over an older saved draft');
assert.equal(adopted.product, 'faki'); assert.equal(adopted.packSize, '500g'); assert.equal(adopted.quantity, 2);
assert.equal(adopted.orderId, '', 'a guest draft never carries an order reference into an account');
assert.equal(adopted.checkoutKey, '');
assert.equal(storage.has('bfp-order-session:guest'), false, 'the guest draft moves into the account instead of lingering');
assert.equal(context.loadState(userTwo).address, '', 'another account never sees the moved draft');
assert.equal(context.hasDraftContent(initialState), false);
assert.equal(context.hasDraftContent({ ...initialState, quantity: 3 }), true);
context.persistDraft(adopted, 'customer-one');
assert.equal(context.loadState(userOne).address, valid.address);
// No fabricated catalog: loading/errors never render metadata as unpriced products.
assert.equal(initialState.products.length, 0);
assert.equal(api.PRODUCT_SHELL.map(p => p.type).join(), "faki,supari,mitho-mavo,water,chuno,tamaku");
for (const product of api.PRODUCT_SHELL) assert.ok(existsSync(new URL(`../public${product.imageUrl}`, import.meta.url)), `${product.type}: the offline fallback photo exists`);
assert.equal(api.PRODUCTS, undefined, 'hard-coded price list must not exist');
// Payment retries are idempotent per attempt; a new attempt (new proof or after a rejection) gets a new key.
const keyStore = new Map();
const keyStorage = { getItem: key => keyStore.get(key) ?? null, setItem: (key, value) => keyStore.set(key, value) };
const shot = { name: 'proof.png', size: 1234, type: 'image/png', lastModified: 1760000000000 };
const firstKey = paymentsApi.paymentAttemptKey('order-1', shot, 0, keyStorage);
assert.equal(paymentsApi.paymentAttemptKey('order-1', shot, 0, keyStorage), firstKey, 'a retry or double click reuses the key');
assert.notEqual(paymentsApi.paymentAttemptKey('order-1', { ...shot, size: 99 }, 0, keyStorage), firstKey, 'a different screenshot is a different attempt');
assert.notEqual(paymentsApi.paymentAttemptKey('order-1', shot, 1, keyStorage), firstKey, 'after a rejection the same proof is a NEW attempt');
assert.notEqual(paymentsApi.paymentAttemptKey('order-2', shot, 0, keyStorage), firstKey);
assert.match(firstKey, /^payment-order-1-/);
assert.ok(paymentsApi.paymentAttemptKey('order-1', shot, 0, null).startsWith('payment-order-1-'), 'works without storage');

// Signed QR paths are accepted; other schemes are not. Rejection history is validated.
const baseOrder = { id: 'o1', orderNumber: '#BFP-1', product: 'faki', productName: 'Faki', packSize: '500g', quantity: 1, subtotal: 500, deliveryFee: 0, total: 500, customerName: 'A', phone: '+919876543210', address: 'Somewhere in Rajkot', pinCode: '360005', status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z' };
const withQr = qr => ({ ...baseOrder, payment: { amount: 500, payeeName: 'LOCAL TEST', upiId: 'local-test@upi', qrImageUrl: qr, settingsConfirmed: false } });
assert.equal(contracts.readOrder(withQr('/api/orders/o1/payment-qr?sig=abc123&exp=1760000900')).payment.settingsConfirmed, false);
assert.throws(() => contracts.readOrder(withQr('javascript:alert(1)')));
assert.throws(() => contracts.readOrder(withQr('/api/orders/o1/payment-qr?sig=<script>')));
assert.throws(() => contracts.readOrder({ ...withQr('https://example.test/qr.png'), payment: { ...withQr('https://example.test/qr.png').payment, settingsConfirmed: 'yes' } }));
const rejected = { orderId: 'o1', orderNumber: '#BFP-1', status: 'PENDING', orderStatus: 'PENDING_PAYMENT', rejectionReason: 'Screenshot is blurry', canSubmitProof: true, latestAttemptStatus: 'REJECTED', attempts: [{ id: 'a1', status: 'REJECTED' }] };
assert.equal(contracts.readPaymentStatus(rejected, 'o1').rejectionReason, 'Screenshot is blurry');
assert.throws(() => contracts.readPaymentStatus({ ...rejected, attempts: [{ status: 'REJECTED' }] }, 'o1'));
assert.throws(() => contracts.readPaymentStatus({ ...rejected, canSubmitProof: 'yes' }, 'o1'));
let enteredMobile=''; let inputValidity='';
const mobileElement=mobileInput({value:'',onChange:value=>{enteredMobile=value;}}).props.children[1];
assert.equal(mobileElement.props.maxLength,10);
mobileElement.props.onChange({target:{value:'98x765432100'},currentTarget:{setCustomValidity:message=>{inputValidity=message;}}});
assert.equal(enteredMobile,'9876543210');
const pasteMobile=value=>mobileElement.props.onPaste({preventDefault(){},clipboardData:{getData:()=>value},currentTarget:{setCustomValidity:message=>{inputValidity=message;},reportValidity(){}}});
pasteMobile('+91 69876 54321'); assert.equal(enteredMobile,'6987654321');
pasteMobile('9876543210123'); assert.ok(inputValidity); assert.equal(enteredMobile,'6987654321','Do not silently truncate an overlong pasted number');
const proof = {...valid, orderId:'old', serverOrder:{id:'old'}, paymentStatus:'verified', screenshotFile:{}, screenshotPreview:'blob:old', checkoutKey:'old-key'};
for (const action of [{type:'SET_PRODUCT',payload:'supari'}, {type:'SET_PACK_SIZE',payload:'1kg'}, {type:'SET_QUANTITY',payload:3}, {type:'SET_FIELD',payload:{field:'address',value:'Another address'}}]) {
  const next = reducer(proof, action);
  assert.equal(next.orderId, ''); assert.equal(next.serverOrder, null); assert.equal(next.paymentStatus, null);
  assert.equal(next.screenshotFile, null); assert.equal(next.screenshotPreview, ''); assert.equal(next.checkoutKey, '');
}
assert.equal(reducer(valid,{type:'SET_QUANTITY',payload:99}).quantity,20);
assert.equal(reducer(valid,{type:'SET_QUANTITY',payload:NaN}).quantity,2);
const saved = restoreDraft(JSON.stringify(proof));
assert.equal(saved.serverOrder,null); assert.equal(saved.paymentStatus,null);
assert.equal(saved.checkoutKey,'old-key'); assert.equal(saved.orderId,'old');
assert.equal(restoreDraft('{').product,'faki');
assert.equal(restoreDraft(JSON.stringify({product:'Invalid Product',quantity:'bad',fullName:5})).product,'faki');
assert.equal(buildSummary(initialState).total,null);
assert.equal(api.formatINR(0),'₹0'); assert.equal(api.formatINR(null),'Awaiting price');
assert.ok(paymentsApi.validateScreenshot(null));
assert.ok(paymentsApi.validateScreenshot({type:'image/svg+xml',size:5}));
assert.ok(paymentsApi.validateScreenshot({type:'image/png',size:0}));
assert.ok(paymentsApi.validateScreenshot({type:'image/png',size:6*1024*1024}));
assert.ok(paymentsApi.validateScreenshot({type:'image/png',size:4*1024*1024+1}), 'the host rejects bodies above 4.5 MB, so screenshots stop at 4 MB');
assert.equal(paymentsApi.validateScreenshot({type:'image/png',size:4*1024*1024}),null);
assert.equal(paymentsApi.validateScreenshot({type:'image/png',size:128}),null);
assert.equal(paymentsApi.validateUtr, undefined, 'the customer no longer enters a UTR');
for (const status of ['pending_payment','verifying_payment']) assert.equal(paymentsApi.isPaymentConfirmed({status:'verified',orderStatus:status}),false);
assert.equal(paymentsApi.isPaymentConfirmed({status:'verified',orderStatus:'active'}),true);
assert.equal(paymentsApi.isPaymentConfirmed({status:'verifying',orderStatus:'active'}),false);
assert.throws(() => contracts.readQuote({subtotal:100,deliveryFee:0,total:101,currency:'INR'}));
assert.throws(() => contracts.readQuote({subtotal:-1,deliveryFee:0,total:-1,currency:'INR'}));
assert.equal(contracts.readQuote({subtotal:100,deliveryFee:0,total:100,currency:'INR'}).deliveryFee,0);
assert.throws(() => contracts.readProducts([{type:'faki'}]));
const catalogProduct = {type:'faki',name:'Faki',nameGu:'ફાકી',category:'Faki',description:'',imageUrl:'/images/faki.png',information:{ingredients:'Test-confirmed ingredients.',popularity:'',characteristics:'',productionPackaging:'Test-confirmed packaging.',providerManufacturer:'',safetyStorage:'Test-confirmed storage guidance.'},packSizes:['250g','500g','1kg'],prices:{'250g':250,'500g':500,'1kg':1000}};
// Products and pack sizes come from the catalogue: any slug-shaped product and unit-shaped pack size is accepted by the client.
// Typed amounts: 100 g to 10 kg in 50 g steps, priced per kg and rounded half-up to a rupee (same as the server).
assert.equal(api.formatPackSize('2500g'),'2.5 kg'); assert.equal(api.formatPackSize('750g'),'750 g');
assert.equal(amount.canonicalAmount(2000),'2kg'); assert.equal(amount.canonicalAmount(2500),'2500g'); assert.equal(amount.amountToGrams('2kg'),2000);
assert.equal(amount.amountToGrams('1l'),null,'litres are never a typed weight');
for (const ok of ['100g','750g','2500g','10kg']) assert.equal(amount.typedAmountError(ok),null,ok);
for (const bad of ['50g','125g','10050g','11kg','0g','1l']) assert.ok(amount.typedAmountError(bad),bad);
assert.equal(amount.perKgPrice(800,750),600); assert.equal(amount.perKgPrice(333,150),50); assert.equal(amount.perKgPrice(330,150),50); assert.equal(amount.perKgPrice(329,150),49);
{
  const typedCatalog={...catalogProduct,pricePerKg:800};
  let typed=reducer({...initialState,products:[typedCatalog]},{type:'SET_CUSTOM_AMOUNT',payload:'750g'});
  assert.equal(typed.customAmount,true);
  assert.equal(buildSummary(typed).subtotal,600,'the typed amount is priced per kg before the server quote arrives');
  assert.equal(JSON.stringify(toOrderFormData({...valid,...typed}).customAmount),'true','the request tells the server it is a typed amount');
  assert.match(validateForm({...valid,packSize:'125g',customAmount:true}).packSize,/steps of 50 g/);
  assert.equal(validateForm({...valid,packSize:'750g',customAmount:true}).packSize,undefined);
  typed=reducer(typed,{type:'SET_PACK_SIZE',payload:'1kg'});
  assert.equal(typed.customAmount,false,'choosing a pack leaves typed mode');
  assert.equal(restoreDraft(JSON.stringify({...valid,packSize:'750g',customAmount:true})).customAmount,true,'a saved typed amount survives a refresh');
  assert.equal(restoreDraft(JSON.stringify({...valid,packSize:'125g',customAmount:true})).customAmount,false,'an invalid saved amount is dropped');
  const noTyped=reducer({...initialState,product:'faki',packSize:'750g',customAmount:true},{type:'SET_CATALOG',payload:{products:[catalogProduct],status:''}});
  assert.equal(noTyped.customAmount,false,'typed mode ends when the owner switches per-kg pricing off');
}
assert.equal(api.formatPackSize('250g'),'250 g'); assert.equal(api.formatPackSize('1kg'),'1 kg'); assert.equal(api.formatPackSize('500ml'),'500 ml'); assert.equal(api.formatPackSize('1l'),'1 L');
const withWater = reducer({...valid,products:[{...catalogProduct,type:'water',name:'Water Bottle',packSizes:['1l'],prices:{'1l':20}}]},{type:'SET_PRODUCT',payload:'water'});
assert.equal(withWater.product,'water'); assert.equal(withWater.packSize,'1l','the default pack size comes from the product, not a fixed list');
assert.equal(validateForm({...valid,product:'mitho-mavo',packSize:'500ml'}).product,undefined);
const fallback = reducer({...valid,product:'gone',packSize:'9kg'},{type:'SET_CATALOG',payload:{products:[catalogProduct],status:''}});
assert.equal(fallback.product,'faki'); assert.equal(fallback.packSize,'250g','a stale draft falls back to a product and pack size that exist');
const waterProduct = {...catalogProduct,type:'water',name:'Water Bottle',packSizes:['1l'],prices:{'1l':20}};
assert.equal(contracts.readProducts([waterProduct])[0].packSizes[0],'1l');
assert.throws(() => contracts.readProducts([{...waterProduct,packSizes:['1 L'],prices:{'1 L':20}}]), 'malformed pack sizes are still rejected');
assert.equal(contracts.readProducts([catalogProduct])[0].information.ingredients,'Test-confirmed ingredients.');
assert.throws(() => contracts.readProducts([{...catalogProduct,information:{ingredients:1}}]));
assert.throws(() => contracts.readPaymentStatus({orderId:'other',orderNumber:'BFP',status:'verified',orderStatus:'active'},'mine'));
const order = {id:'UI-PREVIEW-NO-ORDER',orderNumber:'#UI-PREVIEW', product:'faki',productName:'Faki',packSize:'500g',quantity:2,subtotal:100,deliveryFee:0,total:100,customerName:'UI preview',phone:'9999999999',address:'Design preview only',pinCode:'360005',status:'pending_payment',paymentStatus:'pending',createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z',payment:{amount:100,payeeName:'Design preview — do not pay',upiId:'Not issued'}};
assert.equal(contracts.readOrder(order).id,order.id);
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
await paymentsApi.submitPayment(order.id,{screenshot:new File(['image'],'proof.png',{type:'image/png'})});
assert.equal(request.options.headers.get('Content-Type'),null,'Browser sets multipart boundary');
assert.equal(request.options.body.get('utr'),null,'no UTR is sent: the screenshot is the only evidence');
assert.ok(request.options.body.get('screenshot'));
fakeFetch=async () => new Response(JSON.stringify({detail:[{msg:'PIN not served'}]}),{status:422});
await assert.rejects(api.apiFetch('/test'),/PIN not served/);
fakeFetch=async () => {throw new TypeError('network')};
await assert.rejects(api.apiFetch('/test'),/Cannot reach/);
fakeFetch=async () => new Response('<html>bad gateway</html>',{status:200});
await assert.rejects(api.apiFetch('/test'),/unreadable/);

// Actual React components rendered with explicitly isolated design-only data; never imported by src.
if (process.argv.includes('--fixtures')) {
  mkdirSync(new URL('../../docs/testing/verification/fixtures/',import.meta.url),{recursive:true});
  const notice=load('src/components/common/Notice.tsx').default;
  const stepper=load('src/components/common/OrderStepper.tsx').default;
  const noOrder=load('src/components/common/NoActiveOrder.tsx',{'react-router-dom':require('react-router-dom')}).default;
  for (const [name,path,state] of [
    ['order','orders/pages/OrderFormPage.tsx',{...initialState,packSize:'500g',quantity:2}],
    ['review','orders/pages/ReviewOrderPage.tsx',valid],
    ['payment','payments/pages/QRPaymentPage.tsx',{...valid,serverOrder:order,orderId:order.id,orderNumber:order.orderNumber,paymentStatus:'pending'}],
    ['verification','payments/pages/PaymentVerificationPage.tsx',{...valid,serverOrder:order,orderId:order.id,orderNumber:order.orderNumber,paymentStatus:'verifying'}],
  ]) {
    const mockContext={...context,useOrder:()=>state,useOrderDispatch:()=>()=>{}};
    const component=load(`src/features/${path}`,{
      '../../../context/OrderContext':mockContext,'../../../lib/api':{...api,formatINR:()=> '₹[TOTAL]'},
      '../../../lib/auth':auth,'../../../lib/env':{env},
      '../../../components/common/OrderStepper':{default:stepper},'../../../components/common/Notice':{default:notice},
      '../../../components/common/NoActiveOrder':{default:noOrder},'../../../components/common/EmailSignIn':{default:()=>null},
      '../../../components/common/MobileNumberInput':{default:mobileInput},'../../../lib/amount':amount,
      '../api/ordersApi':ordersApi,'../api/paymentsApi':paymentsApi,
    }).default;
    const markup=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(component)));
    if(name==='payment') assert.ok(!markup.includes('Pay within'),'No fabricated payment expiry');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Gloock&family=Hind+Vadodara:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/src/styles/globals.css"></head><body><aside class="notice">DESIGN TEST FIXTURE · No order exists. Do not pay. Controls are static.</aside><header class="header"><div class="wrapper"><img src="/images/balaji-logo.png" height="56" width="109" alt="Balaji Faki Point"><nav class="nav">Home　Order　My Orders　Reviews　Visit Store　Help</nav></div></header><main class="page">${markup}</main></body></html>`;
    writeFileSync(new URL(`../../docs/testing/verification/fixtures/${name}.html`,import.meta.url),html);
  }
}
console.log('Core checkout: validation, draft persistence, payment reset, server contracts, bearer auth, idempotency, upload validation and failure handling passed.');
