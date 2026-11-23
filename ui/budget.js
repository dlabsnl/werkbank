// Which waiting terminals go to sleep (memory.js), as a plain function so it is tested on its own (budget.test.js).

/**
 * Terminals that may sleep, the one that has waited longest first: every one that waited longer than the timer
 * (`afterMs`), and while Werkbank uses more than its budget, the ones that waited at least `minMs`, until it is under.
 * @param {{ id: string, quietMs: number, bytes: number }[]} waiting the terminals that may sleep at all (canSleep)
 * @param {{ total: number, budget: number, afterMs: number, minMs: number }} o budget and afterMs 0 = not used
 * @returns {{ id: string, why: 'timer' | 'budget' }[]}
 */
function pickSleepers(waiting, { total, budget, afterMs, minMs }) {
  /** @type {{ id: string, why: 'timer' | 'budget' }[]} */
  const out = [];
  let left = total;
  for (const t of [...waiting].sort((a, b) => b.quietMs - a.quietMs)) {
    const why = afterMs && t.quietMs >= afterMs ? 'timer' : budget && left > budget && t.quietMs >= minMs ? 'budget' : null;
    if (!why) continue;
    out.push({ id: t.id, why });
    left -= t.bytes;
  }
  return out;
}
