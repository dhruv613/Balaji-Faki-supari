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
    name.endsWith('/Notice') || name.endsWith('/Stars') || name.endsWith('/reviewsApi') || name.endsWith('/ordersApi') || name.endsWith('/auth') || name.endsWith('/OrderContext') || name.endsWith('/store') || name.endsWith('/api')
      ? {}
      : require(name)
  ) };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const homeSource = readFileSync(new URL('../src/features/catalog/pages/HomePage.tsx', import.meta.url), 'utf8');
assert.match(homeSource, /<Modal[\s\S]*<ProductDetailsView/, 'a product card opens the full details in a dialog on the same page');
assert.doesNotMatch(homeSource, /to=\{`\/products\//, 'the home page no longer navigates away to see product details');
assert.match(readFileSync(new URL('../src/features/catalog/pages/ProductDetailsPage.tsx', import.meta.url), 'utf8'), /ProductDetailsView/, 'the product page shows the same details view');

const { validateReviewText, validateReviewPhotos } = loadPage('reviews/pages/CustomerReviewsPage.tsx');
assert.ok(validateReviewText('too short'));
const photo = (size) => ({ name: 'p.png', type: 'image/png', size });
assert.equal(validateReviewPhotos([photo(1000)]), null);
assert.match(validateReviewPhotos([photo(4 * 1024 * 1024 + 1)]), /larger than 4 MB/, 'one photo is capped at 4 MB');
assert.match(validateReviewPhotos([photo(2.5 * 1024 * 1024), photo(2.5 * 1024 * 1024)]), /together must be smaller than 4 MB/, 'all photos share the host request limit');
assert.equal(validateReviewText('ગુણવત્તા અને પેકિંગ સારું છે.'), null);
assert.equal(validateReviewText('Very good packing.'), null);
console.log('Secondary pages: product details dialog and review validation passed.');
