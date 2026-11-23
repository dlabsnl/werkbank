// Memory: what Werkbank and each terminal's program use (memory.rs), shown in the sidebar footer and in
// Settings > Memory, and kept in check by sleep. A Claude terminal with its helpers uses 250-700 MB, and before this
// nothing showed it: Task Manager lists those programs on their own, not under Werkbank.
// Sleep: a resumable program that waits for you, out of view, stops; showing the terminal continues its conversation
// (start() in terminal.js waits until the old program has really ended). Which ones sleep: pickSleepers (budget.js).

/** what memory.rs measured last: Werkbank's total with all its programs, and the computer's memory, in bytes */
const memNow = { total: 0, ram: 0 };
const SLEEP_AFTER = 60; // minutes, default of Settings > Memory > Sleep when waiting
const BUDGET = 25; // percent of the computer's memory, default of Settings > Memory > Budget
const MIN_WAIT = 10 * 60000; // the budget never puts a terminal to sleep that waited less than this
const bytes = (/** @type {number} */ b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.round(b / 2 ** 20)} MB`);
const budgetBytes = () => (memNow.ram * (L.memBudget ?? BUDGET)) / 100;
/** @param {Session} s */
const asleep = (s) => !!s.asleep && !rt.get(s.id)?.running && !rt.get(s.id)?.starting;

// What may sleep: a resumable program (Claude) that waits for you, out of view, with nothing typed and nothing it
// started later still running (a command in the background, see memory.rs), and not kept awake by hand.
/** @param {Session} s @returns {boolean} */
function canSleep(s) {
  const r = rt.get(s.id);
  return !!r && r.running && !r.starting && r.working === false && !r.draft && !r.busy && !s.awake && !!s.resumable
    && !!profileOf(s)?.resume && !visible().includes(s.id);
}
// how long it has waited: since it was done, you last typed in it, or it was last in view
const waited = (/** @type {Runtime} */ r) => Date.now() - Math.max(r.idleSince ?? 0, r.inputAt ?? 0, r.seenAt ?? 0);

// Saved in the layout, so a terminal asleep when Werkbank closes stays asleep at the next start ("All terminals" too).
/** @param {Session} s @param {string} why for the log */
function sleep(s, why) {
  const r = rt.get(s.id), run = r?.run;
  if (!r || !run) return;
  s.asleep = true;
  r.running = false;
  r.dying = Promise.race([new Promise((ok) => { run.ended = () => ok(undefined); }), pause(5000)]);
  invoke('kill', { id: s.id }).catch(() => run.ended?.());
  log(`${s.name}: asleep (${why}), frees about ${bytes(r.mem ?? 0)}`);
  renderSide();
  save();
}

// Every 10 s: measure, put to sleep what the timer or the budget picks, and show the figures.
async function tickMemory() {
  const m = await invoke('memory'), shown = visible();
  memNow.total = m.total;
  memNow.ram = m.ram;
  for (const [id, r] of rt) {
    r.mem = m.terminals[id]?.bytes;
    r.busy = !!m.terminals[id]?.busy;
    if (shown.includes(id)) r.seenAt = Date.now();
  }
  // undo puts back the flags of its snapshot: one that runs is awake
  for (const s of allSessions()) if (s.asleep && rt.get(s.id)?.running) s.asleep = undefined;
  const after = L.sleepAfter ?? SLEEP_AFTER;
  const waiting = allSessions().filter(canSleep).map((s) => {
    const r = /** @type {Runtime} */ (rt.get(s.id)); // canSleep checked it is there
    return { id: s.id, quietMs: waited(r), bytes: r.mem ?? 0 };
  });
  for (const p of pickSleepers(waiting, { total: m.total, budget: L.memBudget === 0 ? 0 : budgetBytes(), afterMs: after * 60000, minMs: MIN_WAIT })) {
    const f = findSession(p.id);
    if (f) sleep(f.s, p.why === 'timer' ? `waited ${after} min` : `Werkbank over its memory budget of ${bytes(budgetBytes())}`);
  }
  showMemory();
}
function showMemory() {
  const over = L.memBudget !== 0 && memNow.total > budgetBytes();
  const n = allSessions().filter(asleep).length, el = $('#mem');
  el.textContent = memNow.total ? bytes(memNow.total) : '';
  el.classList.toggle('over', over);
  el.title = `Werkbank uses ${bytes(memNow.total)} of ${bytes(memNow.ram)} with every program in its terminals`
    + `${L.memBudget === 0 ? '' : ` · budget ${bytes(budgetBytes())}${over ? ': over it, waiting terminals go to sleep' : ''}`}${n ? ` · ${n} asleep` : ''}`;
  for (const row of groupsEl.querySelectorAll('.sess')) {
    const s = row instanceof HTMLElement && row.dataset.s ? findSession(row.dataset.s)?.s : undefined;
    if (s) row.setAttribute('title', rowTitle(s));
  }
  const list = pageEl.hidden ? null : pageEl.querySelector('#mem-list');
  if (list) list.innerHTML = memoryList();
}
tickMemory().catch(console.error);
setInterval(() => tickMemory().catch(console.error), 10000);

// Settings > Memory: every terminal by what it uses, with Sleep now.
function memoryList() {
  const rows = allSessions().map((s) => ({ s, b: rt.get(s.id)?.mem ?? 0 })).sort((a, b) => b.b - a.b);
  return rows.map(({ s, b }) => {
    const st = asleep(s) ? 'asleep' : rt.get(s.id)?.running ? (s.awake ? 'kept awake' : rt.get(s.id)?.busy ? 'running something' : '') : 'not started';
    return settingRow(esc(label(s)), [esc(findSession(s.id)?.g.name ?? ''), st].filter(Boolean).join(' · '),
      `<b class="val">${b ? bytes(b) : '–'}</b><button class="icon-btn" data-sleep-now="${s.id}" title="${canSleep(s) ? 'Sleep now' : 'Only a terminal out of view that waits for you can sleep'}"${canSleep(s) ? '' : ' disabled'}>${icon('moon')}</button>`);
  }).join('');
}
