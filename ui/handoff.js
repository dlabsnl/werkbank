// The decisions behind `werkbank wait` and what `read` / `search` give back (api.js), a terminal's label and the away command (attention.js), as plain
// functions so they are tested on their own (handoff.test.js).

// start: how long a Claude gets to begin working on what was sent; settle: how long it must stay done (between two
// steps it can look done for a moment); quiet: how long another program must print nothing to count as done
const WAIT = { start: 15000, settle: 2000, quiet: 5000 };

/**
 * Whether a terminal is done with its work, for `werkbank wait`. The exit codes: 0 done (waiting for you), 2 its
 * program stopped or never started, 4 what was sent did not start any work. (1 = timeout and 3 = no such terminal
 * are decided by the callers.)
 * The trap this avoids: right after `werkbank send` a Claude still shows "done" from its previous answer. `send`
 * therefore leaves a job on the terminal before it types, and while there is one, done only counts after the work
 * has started and ended.
 * @param {WaitInput} t @param {number} now
 * @returns {{ done: boolean, code: number, text: string }} text: the state in words, to follow the terminal's name
 */
function waitVerdict(t, now) {
  const j = t.job;
  const on = (/** @type {string} */ text) => ({ done: false, code: 0, text });
  const end = (/** @type {number} */ code, /** @type {string} */ text) => ({ done: true, code, text });
  if (j?.failed) return end(2, j.failed);
  if (t.exited) return end(2, 'has stopped: its program exited');
  if (j && j.typedAt === undefined) return on('is getting ready for what was sent');
  if (t.asleep) return end(0, 'is asleep: waiting for you');
  if (t.starting) return on('is starting');
  if (!t.running) return end(2, 'has not been started');
  // a program that does not report work (a shell): done when it has printed nothing for a while
  if (!t.reports) return now - Math.max(t.lastOutput ?? 0, j?.typedAt ?? 0) < WAIT.quiet ? on('is running') : end(0, 'is quiet: done');
  if (t.working) return on('is working');
  if (j?.typedAt !== undefined && !j.started) {
    return now - j.typedAt < WAIT.start ? on('got what was sent') : end(4, 'is waiting for you: it did not start working on what was sent');
  }
  return now - (t.idleSince ?? 0) < WAIT.settle ? on('is finishing') : end(0, 'is done: waiting for you');
}

// Text from a terminal's screen or conversation on its way to the program that asked (`werkbank read`, `search`):
// without control characters, so an escape code in it cannot act on that program's terminal. Line breaks and tabs stay.
const printable = (/** @type {string} */ t) => t.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\t\n]/gu, '');

// A terminal's label (`werkbank label`): one short line; control characters and line breaks become spaces.
const TAG_MAX = 24;
// cut by characters, not UTF-16 units: half an emoji is not text
const cleanTag = (/** @type {string} */ t) => Array.from(t.replace(/[\p{Cc}\s]+/gu, ' ').trim()).slice(0, TAG_MAX).join('').trim();

/**
 * Whether the away command runs now for a terminal: amber (finished, not looked at) since `attnAt` for at least
 * `afterMs`, the PC without keyboard or mouse input that long too, and not run yet for this wait.
 * @param {{ attnAt?: number, ranFor?: number }} t @param {{ now: number, idleMs: number, afterMs: number }} o
 */
const awayDue = (t, { now, idleMs, afterMs }) => t.attnAt !== undefined && t.ranFor !== t.attnAt && now - t.attnAt >= afterMs && idleMs >= afterMs;
// The minutes of the away command as layout.json may hold them: a whole number from 1 to 60, else not set.
const awayMinutes = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60 ? v : undefined);
