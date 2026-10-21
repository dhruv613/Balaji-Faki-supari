import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(path, stubs = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('import.meta.env', '__env');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, URL, Headers, FormData, AbortSignal, ...globals, require: name => name in stubs ? stubs[name] : require(name) };
  vm.runInNewContext(compiled, context, { filename: path });
  return context.exports;
}

// Both apps resolve blank/unset values identically; production cannot accidentally call localhost.
for (const path of ['../src/lib/env.ts', '../../admin-panel/src/lib/env.ts']) {
  for (const configured of [undefined, '', '  ']) {
    assert.equal(load(path, {}, { __env: { PROD: true, VITE_API_BASE_URL: configured } }).env.apiBaseUrl, '/api');
    assert.equal(load(path, {}, { __env: { DEV: true, VITE_API_BASE_URL: configured } }).env.apiBaseUrl, 'http://127.0.0.1:8000/api');
  }
  assert.equal(load(path, {}, { __env: { VITE_API_BASE_URL: ' https://api.example.test/api/// ' } }).env.apiBaseUrl, 'https://api.example.test/api');
}

let reply;
const requests = [];
const api = load('../src/lib/api.ts', {
  './env': { env: { apiBaseUrl: '/api' } }, './auth': { getAccessToken: async () => null },
}, { fetch: async (url, options) => { requests.push({ url, options }); return reply(url, options); } });
const store = load('../src/constants/store.ts');
const contracts = load('../src/lib/contracts.ts', { '../constants/store': store });
const catalog = load('../src/features/catalog/api/catalogApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
const ordersApi = load('../src/features/orders/api/ordersApi.ts', { '../../../lib/api': api, '../../../lib/contracts': contracts });
assert.throws(() => contracts.readProducts({}), /product or price information/);
assert.throws(() => contracts.readProducts([{ type: 'faki' }]), /product or price information/);
const product = { type: 'faki', name: 'Faki', nameGu: 'ફાકી', packSizes: ['250g'], prices: { '250g': 275 }, priceConfirmed: { '250g': true }, inStock: { '250g': true } };
reply = () => new Response(JSON.stringify([product]), { status: 200 });
assert.equal((await catalog.fetchProducts())[0].prices['250g'], 275);
assert.equal(requests.at(-1).url, '/api/products');
assert.equal(requests.at(-1).options.cache, 'no-store');
reply = () => new Response(JSON.stringify(product), { status: 200 });
await catalog.fetchProduct('faki');
assert.equal(requests.at(-1).url, '/api/products/faki');
assert.equal(requests.at(-1).options.cache, 'no-store');

// Execute the provider's actual effects with browser events and controlled HTTP replies.
const browser = new EventTarget();
const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
let tick;
let timerCleared = false;
browser.setInterval = (callback, ms) => { assert.equal(ms, 60_000); tick = callback; return 7; };
browser.clearInterval = id => { assert.equal(id, 7); timerCleared = true; };
let effects = [];
let state;
let pathname = '/';
const actions = [];
const context = load('../src/context/OrderContext.tsx', {
  react: { ...React, useEffect: (effect, deps) => effects.push({ effect, deps }), useReducer: () => [state, action => { actions.push(action); state = context.reducer(state, action); }] },
  'react-router-dom': { useLocation: () => ({ pathname }) },
  '../lib/api': api, '../constants/store': store, '../features/catalog/api/catalogApi': catalog,
  '../features/orders/api/ordersApi': ordersApi, '../lib/customer': load('../src/lib/customer.ts'), '../lib/amount': load('../src/lib/amount.ts'),
}, { window: browser, document, sessionStorage: { removeItem() {}, setItem() {} } });
state = { ...context.initialState };
const flush = () => new Promise(resolve => setImmediate(resolve));
const mount = () => {
  effects = [];
  context.OrderProvider({ children: null, user: null });
  assert.ok(effects.some(item => item.deps?.[0] === pathname && item.deps[1] === state.catalogLoadAttempt), 'route and retry trigger catalog reload');
  return effects.map(item => item.effect()).filter(value => typeof value === 'function');
};
reply = () => new Response(JSON.stringify([product]), { status: 200 });
let cleanups = mount();
await flush();
assert.equal(state.products[0].prices['250g'], 275);
assert.equal(state.catalogError, '');
reply = () => new Response(JSON.stringify([{ ...product, prices: { '250g': 310 }, inStock: { '250g': false } }]), { status: 200 });
browser.dispatchEvent(new Event('focus'));
await flush();
assert.equal(state.products[0].prices['250g'], 310);
assert.equal(state.products[0].inStock['250g'], false);
const beforeHidden = requests.length;
document.visibilityState = 'hidden';
tick();
await flush();
assert.equal(requests.length, beforeHidden, 'background tabs do not poll');
document.visibilityState = 'visible';
document.dispatchEvent(new Event('visibilitychange'));
await flush();
assert.equal(requests.length, beforeHidden + 1);
reply = () => { throw new TypeError('offline'); };
browser.dispatchEvent(new Event('pageshow'));
await flush();
assert.equal(state.products.length, 0, 'failed refresh removes stale prices instead of replacing them with shell products');
assert.match(state.catalogError, /Cannot reach/);
assert.equal(state.catalogStatus, '');
cleanups.forEach(cleanup => cleanup());
assert.equal(timerCleared, true);

// A route return/manual retry recovers, and overlapping requests cannot overwrite the result.
state = context.reducer(state, { type: 'RETRY_CATALOG' });
pathname = '/products/faki';
reply = () => new Response(JSON.stringify([product]), { status: 200 });
cleanups = mount();
await flush();
assert.equal(state.catalogError, '');
assert.equal(state.products[0].prices['250g'], 275);
let finish;
reply = () => new Promise(resolve => { finish = resolve; });
const beforeConcurrent = requests.length;
browser.dispatchEvent(new Event('focus'));
browser.dispatchEvent(new Event('pageshow'));
await flush();
assert.equal(requests.length, beforeConcurrent + 1, 'overlapping focus/pageshow events share one pending refresh');
const beforeUnmount = actions.length;
cleanups.forEach(cleanup => cleanup());
finish(new Response(JSON.stringify([product]), { status: 200 }));
await flush();
assert.equal(actions.length, beforeUnmount, 'unmounted request results are ignored');

// Real product price component: approval and stock prevent selection without hiding saved prices.
const { PackPrices } = load('../src/features/catalog/components/ProductParts.tsx', { '../../../lib/api': api });
const render = value => renderToStaticMarkup(React.createElement(PackPrices, { product: value, onSelect() {} }));
assert.match(render(product), /₹275/);
assert.doesNotMatch(render(product), /disabled/);
assert.match(render({ ...product, inStock: { '250g': false } }), /disabled/);
assert.match(render({ ...product, inStock: { '250g': false } }), /Out of stock/);
assert.match(render({ ...product, priceConfirmed: { '250g': false } }), /disabled/);
assert.match(render({ ...product, priceConfirmed: { '250g': false } }), /Development price/);
const historical = { ...state, products: [{ ...product, prices: { '250g': 999 } }], serverOrder: { product: 'faki', productName: 'Faki', packSize: '250g', quantity: 1, subtotal: 275, deliveryFee: 20, total: 295 } };
assert.equal(context.buildSummary(historical).total, 295, 'catalog refresh does not reprice an existing order');

// A cold /order?product=water visit must wait for the API before consuming the selection.
const params = new URLSearchParams('product=water');
let consumed = false;
let selection;
let formEffects = [];
const Form = load('../src/features/orders/pages/OrderFormPage.tsx', {
  react: { ...React, useState: () => [false, () => {}], useEffect: callback => formEffects.push(callback) },
  'react-router-dom': { useNavigate: () => () => {}, useSearchParams: () => [params, () => { consumed = true; }] },
  '../../../context/OrderContext': { ...context, useOrder: () => state, useOrderDispatch: () => action => { selection = action; } },
  '../../../components/common/OrderStepper': {}, '../../../components/common/Notice': {}, '../../../components/common/MobileNumberInput': {},
  '../../../components/common/ProductName': {}, '../../../lib/api': api, '../../../lib/amount': load('../src/lib/amount.ts'),
  '../../catalog/components/ProductParts': { primaryImage: () => null },
}, { URLSearchParams }).default;
state = { ...context.initialState };
Form(); formEffects.forEach(effect => effect());
assert.equal(consumed, false);
assert.equal(selection, undefined);
state = { ...state, products: [{ ...product, type: 'water', packSizes: ['1l'], prices: { '1l': 20 } }] };
formEffects = [];
Form(); formEffects.forEach(effect => effect());
assert.equal(selection?.payload, 'water');
assert.equal(consumed, true);

const Notice = load('../src/components/common/Notice.tsx').default;
const Home = load('../src/features/catalog/pages/HomePage.tsx', {
  'react-router-dom': { Link: ({ children }) => React.createElement('a', null, children) },
  '../../../context/OrderContext': { useOrder: () => state, useOrderDispatch: () => () => {} },
  '../../../components/common/Modal': {}, '../../../components/common/Notice': { default: Notice },
  '../../../components/common/Stars': {}, '../../../components/common/ProductName': {},
  '../../store/storeApi': { useStoreProfile: () => ({ profile: null }), contactDetails: () => ({}) },
  '../components/HeroSlider': { default: () => null }, '../components/ProductDetailsView': {}, '../components/ProductParts': { PackPrices, primaryImage: () => null },
}).default;
state = { ...context.initialState, catalogStatus: '', catalogError: 'Cannot reach the Balaji Faki Point server.' };
const errorMarkup = renderToStaticMarkup(React.createElement(Home));
assert.match(errorMarkup, /role="alert"/);
assert.match(errorMarkup, /Cannot load products and prices/);
assert.match(errorMarkup, /Try again/);
assert.doesNotMatch(errorMarkup, /Awaiting price|product-card__name/);

// Quote failures are distinct from loading and product prices; incomplete typed weights never start a request.
function quoteEffect() {
  effects = [];
  context.OrderProvider({ children: null, user: null });
  return effects.find(item => item.deps?.[0] === state.product && item.deps[1] === state.packSize).effect();
}
state = { ...context.initialState, catalogStatus: '', products: [product], pinCode: '384002', fullName: 'Test Customer', phone: '9876543210', address: 'Example delivery address' };
const quoteFailure = 'PIN code 384002 is outside our current delivery area.';
reply = () => new Response(JSON.stringify({ detail: quoteFailure }), { status: 422 });
let quoteCleanup = quoteEffect();
assert.match(state.quoteStatus, /Checking current totals/);
await flush();
assert.equal(requests.at(-1).url, '/api/checkout/quote');
assert.equal(JSON.parse(requests.at(-1).options.body).pinCode, '384002');
assert.equal(state.quote, null);
assert.equal(state.quoteStatus, '');
assert.equal(state.quoteError, quoteFailure);

const orderStubs = {
  '../../../context/OrderContext': { ...context, useOrder: () => state, useOrderDispatch: () => action => { selection = action; } },
  '../../../lib/api': api, '../../../lib/env': { env: { supportWhatsApp: '918000961030' } },
  '../../../lib/auth': { useSession: () => ({ session: { user: { id: 'quote-test-customer' } } }) },
  '../../../components/common/OrderStepper': { default: () => null }, '../../../components/common/Notice': { default: Notice },
  '../../../components/common/EmailSignIn': { default: () => null },
  '../../../components/common/ProductName': { default: ({ name }) => name },
  '../../catalog/components/ProductParts': { primaryImage: () => null }, '../api/ordersApi': ordersApi,
};
const Review = load('../src/features/orders/pages/ReviewOrderPage.tsx', orderStubs).default;
const { MemoryRouter } = require('react-router-dom');
const reviewMarkup = () => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Review)));
let markup = reviewMarkup();
assert.match(markup, /Cannot calculate checkout total/);
assert.match(markup, /PIN code 384002 is outside our current delivery area/);
assert.match(markup, /Unavailable/);
assert.doesNotMatch(markup, /Awaiting price|Online ordering is not connected yet/);
assert.match(markup, /id="continue-payment-btn"[^>]*disabled/, 'failed quotes never enable checkout');
assert.ok(markup.indexOf('Cannot calculate checkout total') > markup.indexOf('id="amount-to-pay"'), 'the error is beside the payable totals');
const FormView = load('../src/features/orders/pages/OrderFormPage.tsx', {
  ...orderStubs, '../../../components/common/MobileNumberInput': { default: () => null }, '../../../lib/amount': load('../src/lib/amount.ts'),
}).default;
const formMarkup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FormView)));
assert.match(formMarkup, /PIN code 384002 is outside our current delivery area/);
assert.match(formMarkup, /Unavailable/);
assert.doesNotMatch(formMarkup, /Awaiting price/);

// The existing catalog retry updates products and re-runs the quote with current server data.
quoteCleanup();
state = context.reducer(state, { type: 'RETRY_CATALOG' });
reply = url => new Response(JSON.stringify(url.endsWith('/products') ? [product] : { subtotal: 275, deliveryFee: 20, total: 295, currency: 'INR' }), { status: 200 });
effects = [];
context.OrderProvider({ children: null, user: null });
const retryCleanup = effects.find(item => item.deps?.[0] === pathname && item.deps[1] === state.catalogLoadAttempt).effect();
await flush();
quoteCleanup = quoteEffect();
await flush();
assert.equal(state.quoteError, '');
assert.equal(state.quote.total, 295);
assert.match(reviewMarkup(), /₹295/);
quoteCleanup();
retryCleanup();

const beforeIncompleteAmount = requests.length;
state = { ...state, customAmount: true, packSize: '0g', quoteError: '', quoteStatus: '' };
quoteEffect();
await flush();
assert.equal(requests.length, beforeIncompleteAmount);
assert.equal(state.quote, null, 'an invalid amount clears the previously quoted total');
assert.equal(state.quoteStatus, '', 'an incomplete typed weight cannot leave an infinite checking state');
assert.match(state.quoteError, /100 g|10 kg/);
state = { ...state, customAmount: false, packSize: '250g', pinCode: '36000' };
quoteEffect();
assert.equal(state.quoteError, '');
assert.equal(state.quoteStatus, '');
assert.equal(state.quote, null);
state = { ...state, pinCode: '360005', quoteStatus: 'Checking current totals…' };
markup = reviewMarkup();
assert.match(markup, /Pending quote/);
assert.match(markup, /Checking current totals/);
assert.doesNotMatch(markup, /Awaiting price|Online ordering is not connected yet/);
console.log('Catalog: shared dev/production API config, no-cache reads, focus/visibility/pageshow/route/retry refresh, failures, concurrency, stock/approval selection and historical order prices passed.');
