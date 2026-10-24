// One terminal: its xterm and pane, starting and stopping its program, opening new ones and removing them.

/** @param {Session} s @returns {Runtime} */
function runtime(s) {
  let r = rt.get(s.id);
  if (r) return r;
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.dataset.id = s.id;
  pane.innerHTML = `<div class="term"></div><div class="pbar">
    <button data-split="row" title="Split right (Alt+Shift+=) · right-click: choose">${icon('splitRight', 14)}</button>
    <button data-split="col" title="Split down (Alt+Shift+-) · right-click: choose">${icon('splitDown', 14)}</button>
    <span></span><button data-max></button><button data-close title="Hide from view (keeps running)">${icon('x', 14)}</button></div>
    <div class="find" hidden><input placeholder="Find" spellcheck="false">
    <button data-find="prev" title="Previous (Shift+Enter)">${icon('up', 14)}</button>
    <button data-find="next" title="Next (Enter)">${icon('down', 14)}</button>
    <button data-find="close" title="Close (Esc)">${icon('x', 14)}</button></div>`;
  const term = new Terminal({ scrollback: 10000, ...termOptions() });
  const fit = new FitAddon.FitAddon(), ser = new SerializeAddon.SerializeAddon(), search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(ser);
  term.loadAddon(search);
  // web links open with Ctrl+click, like in Windows Terminal (a plain click selects text)
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, url) => { if (e.ctrlKey) invoke('open_url', { url }).catch(console.error); }));
  term.registerLinkProvider(fileLinkProvider(s, term)); // path:line, links.js
  r = { term, fit, ser, search, pane, opened: false, running: false, exited: false, unread: false };
  rt.set(s.id, r);
  new ResizeObserver(() => { if (r.opened && pane.isConnected) try { fit.fit(); } catch {} }).observe(pane);
  /** @type {HTMLElement} */ (pane.querySelector('[data-close]')).onclick = (e) => { e.stopPropagation(); hide(s.id); };
  /** @type {HTMLElement} */ (pane.querySelector('[data-max]')).onclick = (e) => { e.stopPropagation(); setActive(s.id); toggleZoom(); };
  const box = /** @type {HTMLElement} */ (pane.querySelector('.find')), q = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  const go = (/** @type {boolean} */ back) => (back ? search.findPrevious(q.value) : search.findNext(q.value));
  q.oninput = () => search.findNext(q.value, { incremental: true });
  q.onkeydown = (e) => {
    if (e.key === 'Enter') go(e.shiftKey);
    if (e.key === 'Escape') { e.stopPropagation(); closeFind(r); }
  };
  box.onclick = (e) => {
    const a = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-find]'))?.dataset.find;
    if (a === 'close') closeFind(r);
    else if (a) go(a === 'prev');
  };
  // Right click pastes, or copies a selection (like Windows Terminal); Shift + right click opens the terminal menu.
  pane.addEventListener('contextmenu', async (e) => {
    if (!(/** @type {Element} */ (e.target).closest('.term'))) return;
    setActive(s.id);
    if (e.shiftKey) return terminalMenu(s, r, { x: e.clientX, y: e.clientY });
    e.preventDefault();
    // a program that reads the mouse gets the right click itself (Claude Code then pastes on its own: twice otherwise)
    if (term.modes.mouseTrackingMode !== 'none') return;
    if (term.hasSelection()) copySelection(term);
    else pasteInto(term);
  });
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (pane.querySelectorAll('[data-split]'))) {
    newTerminalButton(b, (/** @type {Profile} */ p, /** @type {MouseEvent} */ e, /** @type {number} */ n) => {
      const g = findSession(s.id)?.g;
      if (!g) return;
      if (n > 1) return openMany(g, p, n);
      newSession(g, p, { target: s.id, dir: /** @type {'row' | 'col'} */ (b.dataset.split) });
    }, () => groupProfile(findSession(s.id)?.g));
  }
  pane.addEventListener('mousedown', () => setActive(s.id));
  // copy on select (Settings > Terminal): on mouseup, not on every selection change while dragging
  pane.addEventListener('mouseup', () => { if (L.copySelect && term.hasSelection()) withClipboard(() => clipboard.writeText(term.getSelection())).catch((e) => log('copy failed:', e)); });
  term.attachCustomKeyEventHandler((e) => !shortcut(e, term));
  term.onData((d) => {
    if (r.exited) { if (d === '\r') start(s); return; }
    // Programs query the terminal at startup (Claude Code waits for the answers); xterm can answer before spawn has
    // returned, so input that arrives while starting is queued and sent right after, instead of being dropped.
    if (!r.running) { if (r.starting) (r.pending ??= []).push(d); return; }
    writeTo(r, s.id, d);
    // shortcut: Claude only stores a conversation after the first prompt, so "Enter was typed" stands in for "has one"
    if (d.includes('\r') && !s.resumable && profileOf(s)?.resume) { s.resumable = true; save(); }
  });
  term.onResize(({ cols, rows }) => { if (r.running) invoke('resize', { id: s.id, cols, rows }).catch(() => {}); });
  term.onBell(() => attention(s.id));
  // Claude Code is busy while it reports progress (OSC 9;4, which it sends to ConEmu-style terminals, see pty.rs) or
  // animates its title; both quiet = done, maybe waiting for you. Either signal alone has broken before: the title
  // glyphs changed in 2.1.30x, and the progress cleared during tool calls in some versions.
  const busy = () => {
    const now = !!(r.progress || r.spinning);
    if (r.working && !now) attention(s.id);
    if (!r.working && now) calm(s.id); // it went on by itself (a background job finished): no longer waiting for you
    r.working = now;
  };
  term.parser.registerOscHandler(9, (d) => {
    if (!d.startsWith('4;')) return false;
    r.progress = ['1', '3'].includes(d.split(';')[1]); // 1 = percentage, 3 = indeterminate; 0 = cleared
    busy();
    return true;
  });
  // Programs set a window title (Claude Code: the conversation topic); it becomes the terminal's name (see label).
  // Leading spinner/status glyphs are stripped so the sidebar only redraws when the topic itself changes.
  term.onTitleChange((t) => {
    // its title animates while it works (◐/◑ since 2.1.30x, a braille spinner before) and shows ✳ when idle
    r.spinning = /^[\u2800-\u28ff\u25d0-\u25d3]/.test(t);
    busy();
    const title = t.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (title === r.title) return;
    r.firstTitle ??= title;
    r.title = title;
    paneTitle(s);
    renderSide();
  });
  return r;
}

// Find in a terminal's output (Ctrl+Shift+F): a small box over the pane; Enter = next, Shift+Enter = previous.
/** @param {Runtime} r */
function openFind(r) {
  const box = /** @type {HTMLElement} */ (r.pane.querySelector('.find')), q = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  box.hidden = false;
  if (r.term.hasSelection()) q.value = r.term.getSelection();
  q.select();
  q.focus();
}
/** @param {Runtime} r */
function closeFind(r) {
  /** @type {HTMLElement} */ (r.pane.querySelector('.find')).hidden = true;
  r.search.clearDecorations();
  r.term.focus();
}

// Text for a terminal's program, in order: Tauri's IPC calls can overtake each other (Ctrl+S then q arrived as
// q, Ctrl+S), so each write waits for the one before it. Resolves once this text was handed over.
/** @param {Runtime} r @param {string} id @param {string} data @returns {Promise<void>} */
function writeTo(r, id, data) {
  return (r.writes = (r.writes ?? Promise.resolve()).then(() => invoke('write', { id, data })).catch(() => {}));
}

// Profiles with `resume` args (Claude) continue their own conversation; others get their last screen back.
/** @param {Session} s */
async function start(s) {
  const r = runtime(s), p = profileOf(s);
  if (r.starting || r.running) return;
  r.starting = true;
  if (!r.restored) {
    r.restored = true;
    const old = p.resume ? null : await invoke('load_screen', { id: s.id }).catch(() => null);
    if (old) r.term.write(`${old}\r\n\x1b[90m── resumed ──\x1b[0m\r\n`);
  }
  r.exited = false;
  r.resuming = !!(p.resume && s.resumable);
  // A Claude that never got its first prompt saved no conversation, and --resume would fail on every start
  // ("No conversation found"): such a terminal starts fresh under the same id instead.
  if (r.resuming && isClaude(p) && !(await invoke('has_conversation', { id: s.id }).catch(() => true))) {
    log(`${s.name}: no saved conversation, starting it fresh`);
    r.resuming = s.resumable = false;
    save();
  }
  r.startedAt = Date.now();
  const args = ((r.resuming ? p.resume : p.new) ?? []).map((a) => a.replaceAll('{id}', s.id));
  const run = (r.run = {});
  /** @type {import('@tauri-apps/api/core').Channel<ArrayBuffer>} */
  const ch = new Channel();
  /** @type {import('@tauri-apps/api/core').Channel<number | null>} */
  const exit = new Channel();
  ch.onmessage = (buf) => {
    r.lastOutput = Date.now(); // `werkbank send` waits until a program has been quiet for a moment
    r.term.write(new Uint8Array(buf));
    if (!r.pane.isConnected && !r.unread) { r.unread = true; renderSide(); }
  };
  if (rt.get(s.id) !== r) return; // removed while loading its screen; a spawn now would kill the new one's program
  try {
    const spawned = invoke('spawn', { id: s.id, command: [...p.command, ...args], cwd: s.cwd ?? p.cwd ?? null, cols: r.term.cols, rows: r.term.rows, onData: ch, onExit: exit });
    // handled once spawn has answered (a program can end before that), and only while it is still this terminal's
    // program: not after the terminal was removed or started again
    exit.onmessage = (code) => spawned.then(() => { if (rt.get(s.id) === r && r.run === run) onExit(s.id, code); }, () => {});
    await spawned;
    // removed while it was starting (Ctrl+Z right after opening it): its program must not keep running untracked
    if (rt.get(s.id) !== r) {
      if (!rt.has(s.id)) invoke('kill', { id: s.id }).catch(() => {});
      return;
    }
    r.running = true;
    if (r.pending?.length) writeTo(r, s.id, r.pending.join(''));
    r.pending = null;
  } catch (e) {
    r.pending = null;
    log(`${s.name}: could not start ${p.command[0]}: ${e}`);
    r.term.write(`\r\n\x1b[31m${e}\x1b[0m\r\n\x1b[90m[Enter = try again]\x1b[0m\r\n`);
    r.exited = true;
  }
  r.starting = false;
  renderSide();
}

/** @param {string} id @param {number | null} code */
function onExit(id, code) {
  const r = rt.get(id), f = findSession(id);
  if (!r) return;
  r.running = false;
  const spare = Object.entries(spares).find(([, s]) => s.id === id);
  if (spare) { // a warm session died before anyone used it: drop it, the next takeSession starts fresh
    delete spares[spare[0]];
    return drop(id);
  }
  const quick = Date.now() - (r.startedAt ?? 0) < 5000;
  log(`${f ? f.s.name : id}: ${r.resuming ? 'resumed' : 'new'} program stopped after ${Math.round((Date.now() - (r.startedAt ?? 0)) / 1000)} s`);
  // shortcut: a resume that dies within 5s is taken as "no saved conversation yet"; start a fresh one instead
  if (r.resuming && f && quick && !(Date.now() - (r.flippedAt ?? 0) < 10000)) {
    r.flippedAt = Date.now();
    log(`${f.s.name}: starting it without resume`);
    f.s.resumable = false;
    save();
    return start(f.s);
  }
  // and the other way round: a fresh start that dies within 5s ("session id already in use") has a conversation
  // r.flippedAt: one switch per failure, so a program that always dies at once does not loop between the two
  if (!r.resuming && f && profileOf(f.s)?.resume && !f.s.resumable && quick
      && !(Date.now() - (r.flippedAt ?? 0) < 10000)) {
    r.flippedAt = Date.now();
    log(`${f.s.name}: resuming its conversation instead`);
    f.s.resumable = true;
    save();
    return start(f.s);
  }
  // the program ended itself normally (/exit in Claude, exit in a shell): the terminal closes, like a tab in Windows
  // Terminal; Ctrl+Z brings it back. A locked group keeps it, stopped.
  if (code === 0 && f && !isLocked(L.groups, f.g)) {
    log(`${f.s.name}: ended by its program, closed`);
    return removeSession(id);
  }
  r.exited = true;
  r.term.write('\r\n\x1b[90m[process exited — Enter = restart]\x1b[0m\r\n');
  renderSide();
}

// Stops a terminal and throws its runtime away (the caller takes it out of its group). The saved screen stays on
// disk so undo can bring it back; prune_screens clears leftovers at startup.
/** @param {string} id */
function drop(id) {
  invoke('kill', { id }).catch(() => {});
  const r = rt.get(id);
  if (r) { r.term.dispose(); r.pane.remove(); rt.delete(id); }
  if (L.spots) delete L.spots[id];
}
// Stops terminals and takes them out of their groups (the caller made the undo step and redraws).
/** @param {string[]} ids */
function dropFromGroups(ids) {
  for (const id of ids) {
    const f = findSession(id);
    if (!f) continue;
    drop(id);
    f.g.sessions = f.g.sessions.filter((x) => x.id !== id);
  }
}
/** @param {string} id */
function removeSession(id) {
  const f = findSession(id);
  if (!f || isLocked(L.groups, f.g)) return;
  checkpoint(`remove ${f.s.name}`);
  dropFromGroups([id]);
  renderView();
}

// Stop and remove every terminal of a group in one go (one undo step brings them all back).
/** @param {Group} g */
function closeGroup(g) {
  const gs = subtree(L.groups, g).filter((x) => !isLocked(L.groups, x) && x.sessions.length); // its subgroups too
  if (!gs.length) return;
  checkpoint(`close all in ${g.name}`);
  for (const x of gs) {
    for (const s of x.sessions) drop(s.id);
    x.sessions = [];
  }
  renderView();
}

// Profiles with "prestart" keep one warm session running in the background (slow-starting CLIs like
// Claude Code with many hooks), so a new terminal of that profile opens instantly.
/** @type {Record<string, Session>} */
const spares = {}; // profile name -> session not yet in any group
/** @param {Profile | undefined} p */
function prestart(p) {
  if (!p?.prestart || spares[p.name]) return;
  const s = { id: uid(), name: p.name, profile: p.name };
  spares[p.name] = s;
  start(s);
}
// A new terminal for group `g`. It keeps the group's folder for good (Claude finds its conversation by folder), so
// a group with its own folder can't use the warm session, which already runs in the profile's folder.
/** @param {Profile} p @param {string} name @param {Group} g @param {string} [cwd] @returns {Session} */
function takeSession(p, name, g, cwd = g.cwd) {
  if (cwd) return { id: uid(), profile: p.name, name, cwd };
  const s = spares[p.name] ?? { id: uid(), profile: p.name, name };
  delete spares[p.name];
  s.name = name;
  setTimeout(() => prestart(p), 3000);
  return s;
}

// "Claude", "Claude 2", "Claude 3", … so terminals of one profile stay apart in the sidebar.
/** @param {string} base */
function uniqueName(base) {
  const names = new Set(allSessions().map((s) => s.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * @param {Group} g @param {Profile} p @param {{ target: string | null, dir: 'row' | 'col' } | null | false} [at]
 * @param {string} [name] @param {string} [cwd]
 */
function newSession(g, p, at, name = uniqueName(p.name), cwd = g.cwd) {
  checkpoint(`open ${name}`);
  const s = takeSession(p, name, g, cwd);
  g.sessions.push(s);
  g.collapsed = false;
  if (at && L.tree) place(s.id, at.target, at.dir);
  else show(s.id, false);
  return s;
}

/** @param {Group} g @param {Profile} p @param {number} n */
function openMany(g, p, n) {
  checkpoint(`open ${n} × ${p.name}`);
  const ids = Array.from({ length: n }, () => {
    const s = takeSession(p, uniqueName(p.name), g);
    g.sessions.push(s);
    return s.id;
  });
  g.collapsed = false;
  showGrid(ids);
}

// Files dropped from Explorer onto a terminal: their paths are typed into it (quoted when they contain spaces),
// e.g. a screenshot for Claude to look at.
window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(({ payload: p }) => {
  clearDrop();
  if (p.type !== 'over' && p.type !== 'drop') return;
  const at = document.elementFromPoint(p.position.x / devicePixelRatio, p.position.y / devicePixelRatio);
  const pane = at?.closest('.pane'), id = pane instanceof HTMLElement ? pane.dataset.id : undefined, r = id && rt.get(id);
  if (!pane || !id || !r) return;
  if (p.type === 'over') return pane.classList.add('drop');
  r.term.paste(p.paths.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' '));
  setActive(id);
  r.term.focus();
});
