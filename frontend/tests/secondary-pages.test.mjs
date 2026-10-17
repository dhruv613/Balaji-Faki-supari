import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadPage(path) {
  const source = readFileSync(new URL(`../src/features/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require: name => name.endsWith('/Notice') ? {} : require(name) };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const { filterCustomers, customersToCsv } = loadPage('admin/pages/AdminCustomersPage.tsx');
const customers = [
  { id: 'a', name: 'Rahul Mehta', phone: '+91 98XXX XX021', location: 'University Road', status: 'Repeat', orders: 6, lastOrder: '14 Oct 2026', review: 5 },
  { id: 'b', name: 'Amit Joshi', phone: '+91 98XXX XX934', location: 'Yagnik Road', status: 'Pending payment', orders: 1, lastOrder: '15 Oct 2026', review: null },
];
assert.equal(filterCustomers(customers, '  RAHUL ', 'All areas', 'all')[0].id, 'a');
assert.equal(filterCustomers(customers, '934', 'Yagnik Road', 'pending')[0].id, 'b');
assert.equal(filterCustomers(customers, '', 'University Road', 'pending').length, 0);
assert.equal(filterCustomers(customers, 'unknown', 'All areas', 'all').length, 0);
assert.equal(filterCustomers(customers, '', 'All areas', 'repeat').length, 1);
const csv = customersToCsv([{ ...customers[0], name: '=2+2', location: 'Area, "quoted"' }]);
assert.ok(csv.includes('Development reference example'));
assert.ok(csv.includes('"\'=2+2"'), 'CSV cells cannot become spreadsheet formulas');
assert.ok(csv.includes('"\'+91 98XXX XX021"'));
assert.ok(csv.includes('"Area, ""quoted"""'), 'CSV must escape commas and quotes');
assert.equal(csv.split('\r\n').length, 2);

const { validateFeedback } = loadPage('reviews/pages/CustomerReviewsPage.tsx');
assert.equal(Object.keys(validateFeedback({ name: '  ', area: ' ', feedback: 'too short' })).length, 3);
assert.equal(Object.keys(validateFeedback({ name: 'હેતલ', area: 'રાજકોટ', feedback: 'ગુણવત્તા અને પેકિંગ સારું છે.' })).length, 0);
assert.equal(Object.keys(validateFeedback({ name: 'Hetal', area: 'Rajkot', feedback: 'Very good packing.' })).length, 0);
console.log('Secondary pages: combined customer filters, safe sample CSV, and feedback validation passed.');
