// node ui/tree.test.js — tree.js is a plain browser script, so evaluate it (same realm, so deepStrictEqual works).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { leaves, without, splitAt, grid, spotOf, swap } = vm.runInThisContext(
  `${fs.readFileSync(`${__dirname}/tree.js`, 'utf8')}; ({ leaves, without, splitAt, grid, spotOf, swap })`,
);

// hide a pane and put it back: same neighbour, side and ratio give the same tree
const before = { dir: 'row', ratio: 0.3, a: { id: 'x' }, b: { dir: 'col', ratio: 0.5, a: { id: 'y' }, b: { id: 'z' } } };
const spot = spotOf(before, 'z');
assert.deepStrictEqual(spot, { sibling: 'y', dir: 'col', before: false, ratio: 0.5 });
const back = splitAt(without(JSON.parse(JSON.stringify(before)), 'z'), spot.sibling, 'z', spot.dir, spot.before, spot.ratio);
assert.deepStrictEqual(back, before);
assert.deepStrictEqual(spotOf(before, 'x'), { sibling: 'y', dir: 'row', before: true, ratio: 0.3 });
assert.strictEqual(spotOf({ id: 'x' }, 'x'), null);

let t = { id: 'a' };
t = splitAt(t, 'a', 'b', 'row', false);
t = splitAt(t, 'b', 'c', 'col', true);
assert.deepStrictEqual(leaves(t), ['a', 'c', 'b']);
assert.strictEqual(t.b.dir, 'col');

t = without(t, 'c');
assert.deepStrictEqual(t.b, { id: 'b' }, 'sibling replaces the removed pane');
assert.strictEqual(without(without(t, 'a'), 'b'), null);
assert.strictEqual(without(null, 'x'), null);

// 6 -> three columns of two, equal widths; order kept
const six = grid(['1', '2', '3', '4', '5', '6']);
assert.deepStrictEqual(leaves(six), ['1', '2', '3', '4', '5', '6']);
assert.strictEqual(six.dir, 'row');
assert.ok(Math.abs(six.ratio - 1 / 3) < 1e-9);
assert.strictEqual(six.a.dir, 'col');
assert.deepStrictEqual(leaves(six.a), ['1', '2']);
assert.deepStrictEqual(leaves(grid(['a', 'b', 'c'])), ['a', 'b', 'c']);
assert.strictEqual(grid(['a', 'b', 'c']).a.id, 'a', '3 = one row');
assert.deepStrictEqual(grid(['x']), { id: 'x' });

// swap: same splits and ratios, the two panes trade places
const swapped = swap(before, 'x', 'z');
assert.deepStrictEqual(leaves(swapped), ['z', 'y', 'x']);
assert.strictEqual(swapped.ratio, 0.3);
assert.deepStrictEqual(leaves(before), ['x', 'y', 'z'], 'the original is left alone');

console.log('tree ok');
