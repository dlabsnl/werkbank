// node ui/links.test.js — links.js is a plain browser script, so evaluate it (fileLinksIn needs no browser).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { fileLinksIn } = vm.runInThisContext(`${fs.readFileSync(`${__dirname}/links.js`, 'utf8')}; ({ fileLinksIn })`);
const found = (text) => fileLinksIn(text).map(({ path, line, col }) => [path, line, col]);

assert.deepStrictEqual(found('src/main.rs:12:5: error[E0308]'), [['src/main.rs', 12, 5]]);
assert.deepStrictEqual(found('    at C:\\work\\app.js:3'), [['C:\\work\\app.js', 3, null]]);
assert.deepStrictEqual(found('Foo.cs(10,4): error CS1002'), [['Foo.cs', 10, 4]]);
assert.deepStrictEqual(found('src/a.ts(7, 2): error TS2339'), [['src/a.ts', 7, 2]]);
assert.deepStrictEqual(found('  File "C:\\a\\b.py", line 7, in f'), [['C:\\a\\b.py', 7, null]]);
assert.deepStrictEqual(found('./ui/x.js:1 and ../y.rs:2'), [['./ui/x.js', 1, null], ['../y.rs', 2, null]]);
assert.deepStrictEqual(found('at 12:30, version 1.2, ratio 3:4'), []);
assert.deepStrictEqual(found('see https://example.org/a.js:3'), []);
assert.deepStrictEqual(found('abc.d.ts:3'), [['abc.d.ts', 3, null]]);
const [link] = fileLinksIn('x a.ts:1');
assert.deepStrictEqual([link.start, link.end], [2, 8]);
console.log('links.js: all passed');
