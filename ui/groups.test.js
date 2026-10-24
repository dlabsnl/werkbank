// node ui/groups.test.js — groups.js is a plain browser script, so evaluate it (same realm, so deepStrictEqual works).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { groupTree, subtree, ancestors, groupPath, isLocked, inside, moveGroup } = vm.runInThisContext(
  `${fs.readFileSync(`${__dirname}/groups.js`, 'utf8')}; ({ groupTree, subtree, ancestors, groupPath, isLocked, inside, moveGroup })`,
);

const g = (id, parent, extra = {}) => ({ id, name: id.toUpperCase(), collapsed: false, sessions: [], ...(parent ? { parent } : {}), ...extra });
const ids = (list) => list.map((x) => x.id ?? x.g.id);
const shape = (groups) => groupTree(groups).map((x) => `${x.g.id}:${x.depth}`);

// a, b are top level; a has a1 (which has a1x) and a2; the flat order does not have to follow the tree
const groups = [g('a1', 'a'), g('b'), g('a'), g('a2', 'a'), g('a1x', 'a1')];
assert.deepStrictEqual(shape(groups), ['b:0', 'a:0', 'a1:1', 'a1x:2', 'a2:1']);
assert.deepStrictEqual(ids(subtree(groups, groups[2])), ['a', 'a1', 'a2', 'a1x']);
assert.deepStrictEqual(ids(ancestors(groups, groups[4])), ['a1', 'a']);
assert.strictEqual(groupPath(groups, groups[4]), 'A/A1/A1X');
assert.strictEqual(groupPath(groups, groups[1]), 'B');

// a lock covers the subgroups
groups[2].locked = true;
assert.ok(isLocked(groups, groups[4]) && !isLocked(groups, groups[1]));
delete groups[2].locked;

// a group is inside itself and its subgroups, not in its parent
assert.ok(inside(groups, groups[2], groups[2]) && inside(groups, groups[4], groups[2]) && !inside(groups, groups[2], groups[4]));

// a parent that is gone, and a loop, still show every group once
assert.deepStrictEqual(ids(groupTree([g('x', 'gone'), g('y')])), ['x', 'y']);
const loop = [g('p', 'q'), g('q', 'p'), g('s', 's')];
assert.deepStrictEqual(ids(groupTree(loop)).sort(), ['p', 'q', 's']);
assert.strictEqual(ancestors(loop, loop[0]).length, 1);

// move: before / after another group takes its level, into puts it last inside
const m = [g('a'), g('b'), g('c', 'b')];
const by = (id) => m.find((x) => x.id === id);
moveGroup(m, by('c'), by('a'), 'after'); // c leaves b, lands after a at the top
assert.deepStrictEqual(shape(m), ['a:0', 'c:0', 'b:0']);
moveGroup(m, by('a'), by('b'), 'into');
assert.deepStrictEqual(shape(m), ['c:0', 'b:0', 'a:1']);
moveGroup(m, by('a'), by('c'), 'before');
assert.deepStrictEqual(shape(m), ['a:0', 'c:0', 'b:0']);

console.log('groups.test.js: ok');
