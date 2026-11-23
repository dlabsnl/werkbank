// node ui/handoff.test.js — handoff.js is a plain browser script, so evaluate it (same realm, so deepStrictEqual works).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { waitVerdict, cleanTag, awayDue, printable, awayMinutes, WAIT } = vm.runInThisContext(`${fs.readFileSync(`${__dirname}/handoff.js`, 'utf8')}; ({ waitVerdict, cleanTag, awayDue, printable, awayMinutes, WAIT })`);

const NOW = 1000000;
// a Claude that finished its last answer long ago
const claude = { reports: true, running: true, starting: false, exited: false, asleep: false, working: false, idleSince: NOW - 60000 };
const shell = { reports: false, running: true, starting: false, exited: false, asleep: false, lastOutput: NOW - 60000 };
const v = (/** @type {object} */ t, now = NOW) => { const r = waitVerdict(t, now); return r.done ? r.code : 'waits'; };

// nothing sent: the state as it is
assert.strictEqual(v(claude), 0);
assert.strictEqual(v({ ...claude, working: true }), 'waits');
assert.strictEqual(v({ ...claude, idleSince: NOW - 500 }), 'waits'); // just went quiet: may be between two steps
assert.strictEqual(v({ ...claude, working: undefined }), 0); // a fresh Claude that has not worked yet
assert.strictEqual(v({ ...claude, running: false, asleep: true }), 0);
assert.strictEqual(v({ ...claude, running: false, exited: true }), 2);
assert.strictEqual(v({ ...claude, running: false }), 2); // never started
assert.strictEqual(v({ ...claude, running: false, starting: true }), 'waits');

// the trap: send, then wait at once. The "done" of the previous answer must not count.
assert.strictEqual(v({ ...claude, job: {} }), 'waits'); // sent, not typed yet (the program is loading)
assert.strictEqual(v({ ...claude, running: false, asleep: true, job: {} }), 'waits'); // sent to an asleep one: it wakes first
assert.strictEqual(v({ ...claude, job: { typedAt: NOW - 1000 } }), 'waits'); // typed, Claude has not started yet
assert.strictEqual(v({ ...claude, working: true, job: { typedAt: NOW - 3000, started: true } }), 'waits');
// done again: api.js takes the job off when the work it started ends
assert.strictEqual(v({ ...claude, idleSince: NOW - WAIT.settle }), 0);
// it never started (a slash command, or the prompt got lost): said so, with its own code
assert.strictEqual(v({ ...claude, job: { typedAt: NOW - WAIT.start } }), 4);
assert.strictEqual(v({ ...claude, job: { typedAt: NOW - WAIT.start + 1 } }), 'waits');
// the program never got ready: nothing was typed
assert.deepStrictEqual(waitVerdict({ ...claude, job: { failed: 'did not get ready' } }, NOW), { done: true, code: 2, text: 'did not get ready' });
assert.strictEqual(v({ ...claude, running: false, exited: true, job: {} }), 2);

// a shell: quiet for a while = done, counted from what was typed too
assert.strictEqual(v(shell), 0);
assert.strictEqual(v({ ...shell, lastOutput: NOW - 1000 }), 'waits');
assert.strictEqual(v({ ...shell, job: {} }), 'waits');
assert.strictEqual(v({ ...shell, job: { typedAt: NOW - 1000 } }), 'waits');
assert.strictEqual(v({ ...shell, job: { typedAt: NOW - WAIT.quiet } }), 0);
assert.strictEqual(v({ ...shell, lastOutput: undefined }), 0);

// labels: one short line
assert.strictEqual(cleanTag('  #1072 · waiting  '), '#1072 · waiting');
assert.strictEqual(cleanTag('a\r\nb\x1b[31m\tc'), 'a b [31m c');
assert.strictEqual(cleanTag('\x07 \n'), '');
assert.strictEqual(Array.from(cleanTag('😀'.repeat(40))).length, 24);
assert.strictEqual(cleanTag(`${'x'.repeat(23)} y`), 'x'.repeat(23)); // no space left at the cut

// the away command: amber long enough, the PC idle long enough, once per wait
const MIN = 60000, o = { now: NOW, idleMs: 11 * MIN, afterMs: 10 * MIN };
assert.strictEqual(awayDue({ attnAt: NOW - 10 * MIN }, o), true);
assert.strictEqual(awayDue({ attnAt: NOW - 9 * MIN }, o), false);
assert.strictEqual(awayDue({ attnAt: NOW - 10 * MIN }, { ...o, idleMs: 2 * MIN }), false); // you are at the keyboard
assert.strictEqual(awayDue({ attnAt: NOW - 10 * MIN, ranFor: NOW - 10 * MIN }, o), false); // ran for this wait
assert.strictEqual(awayDue({ attnAt: NOW - 10 * MIN, ranFor: 5 }, o), true); // a new wait
assert.strictEqual(awayDue({}, o), false); // not amber

// its minutes from layout.json: a whole number from 1 to 60, anything else is "not set" (the default)
for (const ok of [1, 10, 60]) assert.strictEqual(awayMinutes(ok), ok);
for (const bad of [0, 61, -5, 2.5, NaN, Infinity, '10', null, undefined, {}, [10]]) assert.strictEqual(awayMinutes(bad), undefined);

// what read and search give back: text only, no escape codes for the asking program's terminal
assert.strictEqual(printable('a\x1b[31mred\x07 \x1b]0;title\x07b\x00\x7f\x9b'), 'a[31mred ]0;titleb');
assert.strictEqual(printable('line 1\r\nline 2\rline 3\n\ttab é 😀'), 'line 1\nline 2\nline 3\n\ttab é 😀');

console.log('handoff.js: all passed');
