import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => (name in stubs ? stubs[name] : require(name)) };
  vm.runInNewContext(compiled, context, { filename: path });
  return context.exports;
}

const { buildCustomerProgress } = load('src/features/orders/lib/customerTimeline.ts');
const at = (status, minute) => ({ status, label: status, description: '', timestamp: `2026-10-19T10:${String(minute).padStart(2, '0')}:00Z` });
const states = (progress) => progress.steps.map(step => `${step.key}:${step.state}`).join(',');
const ALL_UPCOMING = 'confirmed:upcoming,packed:upcoming,shipped:upcoming,out_for_delivery:upcoming,delivered:upcoming';

// Before confirmation the customer sees the payment state, never delivery progress.
let progress = buildCustomerProgress({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' }, [at('PENDING_PAYMENT', 0)]);
assert.equal(progress.showSteps, false); assert.equal(states(progress), ALL_UPCOMING);
assert.equal(progress.banner.title, 'Awaiting payment');
progress = buildCustomerProgress({ status: 'PENDING_PAYMENT', paymentStatus: 'REJECTED' }, []);
assert.match(progress.banner.title, /not accepted/);
progress = buildCustomerProgress({ status: 'PAYMENT_REVIEW', paymentStatus: 'SUBMITTED' }, [at('PENDING_PAYMENT', 0), at('PAYMENT_REVIEW', 1)]);
assert.equal(progress.banner.title, 'Payment verification pending');
assert.match(progress.banner.text, /not confirmed until the shop approves/);
assert.equal(progress.showSteps, false);
progress = buildCustomerProgress({ status: 'AWAITING_CONFIRMATION', paymentStatus: 'VERIFIED' }, []);
assert.equal(progress.banner.title, 'Payment verified');
assert.match(progress.banner.text, /confirm your order next/);
assert.equal(states(progress), ALL_UPCOMING);

// Confirmed: first stage done with its real timestamp; the next stage is current.
progress = buildCustomerProgress({ status: 'CONFIRMED', paymentStatus: 'VERIFIED' }, [at('AWAITING_CONFIRMATION', 5), at('CONFIRMED', 10)]);
assert.equal(progress.showSteps, true); assert.equal(progress.banner, null);
assert.equal(states(progress), 'confirmed:done,packed:current,shipped:upcoming,out_for_delivery:upcoming,delivered:upcoming');
assert.equal(progress.steps[0].timestamp, '2026-10-19T10:10:00Z');
assert.equal(progress.steps[1].timestamp, null, 'pending stages have no invented timestamp');

// Packing is detailed backend state; the customer sees "Packed" in progress.
progress = buildCustomerProgress({ status: 'PACKING', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('PACKING', 20)]);
assert.equal(states(progress), 'confirmed:done,packed:current,shipped:upcoming,out_for_delivery:upcoming,delivered:upcoming');
assert.equal(progress.steps[1].detail, 'Packing in progress.');
progress = buildCustomerProgress({ status: 'PACKED', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('PACKING', 20), at('PACKED', 30)]);
assert.equal(states(progress), 'confirmed:done,packed:done,shipped:current,out_for_delivery:upcoming,delivered:upcoming');

// PICKED_UP and SHIPPED both count as Shipped; the earliest event provides the timestamp.
progress = buildCustomerProgress({ status: 'SHIPPED', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('PACKED', 30), at('PICKED_UP', 40), at('SHIPPED', 50)]);
assert.equal(states(progress), 'confirmed:done,packed:done,shipped:done,out_for_delivery:current,delivered:upcoming');
assert.equal(progress.steps[2].timestamp, '2026-10-19T10:40:00Z');
progress = buildCustomerProgress({ status: 'PICKED_UP', paymentStatus: 'VERIFIED' }, [at('PICKED_UP', 40)]);
assert.equal(progress.steps[2].state, 'done');

progress = buildCustomerProgress({ status: 'OUT_FOR_DELIVERY', paymentStatus: 'VERIFIED' }, [at('OUT_FOR_DELIVERY', 55)]);
assert.equal(states(progress), 'confirmed:done,packed:done,shipped:done,out_for_delivery:done,delivered:current');

progress = buildCustomerProgress({ status: 'DELIVERED', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('DELIVERED', 59)]);
assert.equal(states(progress), 'confirmed:done,packed:done,shipped:done,out_for_delivery:done,delivered:done');
assert.equal(progress.steps[4].timestamp, '2026-10-19T10:59:00Z');

// Exceptions never pretend to be progress.
progress = buildCustomerProgress({ status: 'CANCELLED', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('CANCELLED', 12)]);
assert.equal(progress.banner.tone, 'error'); assert.equal(progress.showSteps, false);
progress = buildCustomerProgress({ status: 'DELIVERY_FAILED', paymentStatus: 'VERIFIED' }, [at('CONFIRMED', 10), at('OUT_FOR_DELIVERY', 55), at('DELIVERY_FAILED', 58)]);
assert.equal(progress.banner.tone, 'warning');
assert.equal(states(progress), 'confirmed:done,packed:done,shipped:done,out_for_delivery:done,delivered:upcoming');

// Legacy lower-case statuses are tolerated.
progress = buildCustomerProgress({ status: 'delivered', paymentStatus: 'verified' }, [{ status: 'delivered', label: '', description: '', timestamp: '2026-10-19T10:59:00Z' }]);
assert.equal(progress.steps[4].state, 'done');

// There is no standalone customer Track page or navigation.
const routerSource = readFileSync(new URL('../src/app/router.tsx', import.meta.url), 'utf8');
assert.match(routerSource, /path="track" element=\{<Navigate to="\/my-orders"/);
assert.doesNotMatch(readFileSync(new URL('../src/components/layout/Header.tsx', import.meta.url), 'utf8'), /Track/);

console.log('Orders: five-stage customer timeline, payment-state banners, exceptions and no standalone Track page passed.');
