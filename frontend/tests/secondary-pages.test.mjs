import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadPage(path) {
  const source = readFileSync(new URL(`../src/features/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require: name => (
    name.endsWith('/Notice') || name.endsWith('/Stars') || name.endsWith('/reviewsApi') || name.endsWith('/ordersApi') || name.endsWith('/supabase') || name.endsWith('/OrderContext') || name.endsWith('/store') || name.endsWith('/api')
      ? {}
      : require(name)
  ) };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const customersSource = readFileSync(new URL('../src/features/admin/pages/AdminCustomersPage.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(customersSource, /SAMPLE_|Development reference|XXX XX/, 'the customers screen shows real accounts only');
assert.match(customersSource, /getAdminCustomers\(/, 'customers come from the server');
assert.doesNotMatch(customersSource, /method:\s*'(POST|PATCH|DELETE|PUT)'/, 'customers are read-only');

const homeSource = readFileSync(new URL('../src/features/catalog/pages/HomePage.tsx', import.meta.url), 'utf8');
assert.match(homeSource, /<Modal[\s\S]*<ProductDetailsView/, 'a product card opens the full details in a dialog on the same page');
assert.doesNotMatch(homeSource, /to=\{`\/products\//, 'the home page no longer navigates away to see product details');
assert.match(readFileSync(new URL('../src/features/catalog/pages/ProductDetailsPage.tsx', import.meta.url), 'utf8'), /ProductDetailsView/, 'the product page shows the same details view');

const { validateReviewText } = loadPage('reviews/pages/CustomerReviewsPage.tsx');
assert.ok(validateReviewText('too short'));
assert.equal(validateReviewText('ગુણવત્તા અને પેકિંગ સારું છે.'), null);
assert.equal(validateReviewText('Very good packing.'), null);
console.log('Secondary pages: real read-only customers and review validation passed.');
