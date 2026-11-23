// node ui/budget.test.js — budget.js is a plain browser script, so evaluate it (same realm, so deepStrictEqual works).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { pickSleepers } = vm.runInThisContext(`${fs.readFileSync(`${__dirname}/budget.js`, 'utf8')}; ({ pickSleepers })`);

const MIN = 60000, GB = 2 ** 30;
const t = (/** @type {string} */ id, /** @type {number} */ min, gb = 0.25) => ({ id, quietMs: min * MIN, bytes: gb * GB });
const waiting = [t('new', 2), t('old', 90), t('mid', 20), t('older', 40)];

// the timer alone: only what waited longer than it
assert.deepStrictEqual(pickSleepers(waiting, { total: 4 * GB, budget: 0, afterMs: 60 * MIN, minMs: 10 * MIN }),
  [{ id: 'old', why: 'timer' }]);

// over budget: the longest waiting first, until under it; never one that waited less than the minimum
assert.deepStrictEqual(pickSleepers(waiting, { total: 4.4 * GB, budget: 4 * GB, afterMs: 60 * MIN, minMs: 10 * MIN }),
  [{ id: 'old', why: 'timer' }, { id: 'older', why: 'budget' }]);
assert.deepStrictEqual(pickSleepers(waiting, { total: 9 * GB, budget: 4 * GB, afterMs: 0, minMs: 10 * MIN }),
  [{ id: 'old', why: 'budget' }, { id: 'older', why: 'budget' }, { id: 'mid', why: 'budget' }]);

// under budget and no timer: nothing sleeps
assert.deepStrictEqual(pickSleepers(waiting, { total: 3 * GB, budget: 4 * GB, afterMs: 0, minMs: 10 * MIN }), []);

console.log('budget.js: all passed');
