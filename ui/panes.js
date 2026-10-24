// The window: which terminals are shown, how they are split, focus and moving between panes.

// Put a session in the window next to `target` (default: the focused pane, along its longest side).
/** @param {string} id @param {string | null} [target] @param {'row' | 'col'} [dir] @param {boolean} [before] @param {number} [ratio] */
function place(id, target = L.active, dir = widerDir(target ?? ''), before = false, ratio = 0.5) {
  if (id === target) return;
  pageEl.hidden = true; // picking a terminal leaves the settings page
  zoomed = null;
  L.tree = without(L.tree, id);
  if (!L.tree) L.tree = { id };
  else L.tree = splitAt(L.tree, target && visible().includes(target) ? target : visible()[0], id, dir, before, ratio);
  L.active = id;
  renderView();
}

// Dragging a divider (dir 'row' = sideways): calls move(ev) until the mouse is released, then saves.
/** @param {MouseEvent} e @param {'row' | 'col'} dir @param {(ev: MouseEvent) => void} move */
function drag(e, dir, move) {
  e.preventDefault();
  document.body.classList.add('dragging', dir);
  const up = () => {
    document.body.classList.remove('dragging', dir);
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    save();
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}
const SNAPS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
/** @param {Extract<TreeNode, { dir: unknown }>} node @param {HTMLElement} el */
function gutter(node, el) {
  const g = document.createElement('div');
  g.className = 'gutter';
  g.onmousedown = (e) => {
    let moved = false;
    drag(e, node.dir, (ev) => {
      if (!moved) { moved = true; checkpoint('resize panes'); }
      const r = el.getBoundingClientRect();
      const v = node.dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      // Shift snaps to the usual split points; without it the divider moves freely
      node.ratio = ev.shiftKey ? SNAPS.reduce((p, q) => (Math.abs(q - v) < Math.abs(p - v) ? q : p)) : Math.min(0.9, Math.max(0.1, v));
      // build() appends the two halves (elements) around the gutter
      /** @type {HTMLElement} */ (el.firstChild).style.flex = `${node.ratio} 1 0`;
      /** @type {HTMLElement} */ (el.lastChild).style.flex = `${1 - node.ratio} 1 0`;
    });
  };
  return g;
}

const paneTitle = (/** @type {Session} */ s) => { const el = rt.get(s.id)?.pane.querySelector('.pbar span'); if (el) el.innerHTML = `${progIcon(s.profile, 14)}${esc(label(s))}`; };
/** @param {TreeNode} n @returns {HTMLElement} */
function build(n) {
  if ('id' in n) {
    // renderView drops panes whose session is gone before it builds
    const { s } = /** @type {{ g: Group, s: Session }} */ (findSession(n.id)), r = runtime(s);
    paneTitle(s);
    r.pane.style.setProperty('--pc', colorOf(s.id) || 'transparent');
    return r.pane;
  }
  const el = document.createElement('div');
  el.className = `split ${n.dir}`;
  const a = build(n.a), b = build(n.b);
  a.style.flex = `${n.ratio} 1 0`;
  b.style.flex = `${1 - n.ratio} 1 0`;
  el.append(a, gutter(n, el), b);
  return el;
}

// A pane maximized for now (Ctrl+Shift+Enter): it fills the window, the split layout in L.tree stays as it was.
/** @type {string | null} */
let zoomed = null;
function toggleZoom() {
  if (!L.active || !visible().includes(L.active) || visible().length < 2) return;
  zoomed = zoomed ? null : L.active;
  renderView();
}

// After any change to groups, terminals or the split tree: rebuild the window and the sidebar, save, and settle.
function renderView() {
  const before = document.activeElement;
  buildView();
  renderSide();
  save();
  requestAnimationFrame(() => settleView(before));
}

// The split layout as DOM, nothing else: no programs started, no focus moved, nothing saved.
function buildView() {
  for (const id of visible()) if (!findSession(id)) L.tree = without(L.tree, id);
  const ids = visible();
  if (!L.active || !ids.includes(L.active)) L.active = ids[0] ?? null;
  if (zoomed && !ids.includes(zoomed)) zoomed = null;
  const tree = zoomed ? { id: zoomed } : L.tree, shown = leaves(tree);
  viewEl.replaceChildren();
  viewEl.classList.toggle('single', ids.length < 2);
  if (tree) {
    const root = build(tree);
    root.style.flex = '1 1 0';
    viewEl.append(root);
  }
  $('#empty').hidden = ids.length > 0;
  for (const id of shown) {
    const r = /** @type {Runtime} */ (rt.get(id)), max = /** @type {HTMLElement} */ (r.pane.querySelector('[data-max]')); // build() made both
    r.pane.classList.toggle('active', id === L.active && shown.length > 1);
    max.innerHTML = icon(zoomed ? 'restore' : 'max', 14);
    max.title = zoomed ? 'Back to the split layout (Ctrl+Shift+Enter)' : 'Maximize this pane (Ctrl+Shift+Enter)';
    if (!r.opened) {
      r.term.open(/** @type {HTMLElement} */ (r.pane.querySelector('.term')));
      // the canvas renderer draws box-drawing and block characters itself, so lines join up like in Windows Terminal
      // (the default DOM renderer uses the font glyphs, which leave gaps)
      r.term.loadAddon(new CanvasAddon.CanvasAddon());
      r.opened = true;
    }
    r.unread = false;
    if (id === L.active) r.attn = false;
  }
}

// After a rebuild: the shown terminals fit their panes, every terminal in the tree runs, and the keyboard goes back
// to where it was (a find box the rebuild only detached), stays where it went meanwhile (a menu, the switcher), and
// otherwise goes to the active terminal. Settings keep it.
/** @param {Element | null} before what had the keyboard before the rebuild */
function settleView(before) {
  const shown = leaves(zoomed ? { id: zoomed } : L.tree);
  for (const id of visible()) {
    // a terminal closed before this frame is gone by now
    const r = rt.get(id), f = findSession(id);
    if (!r || !f) continue;
    if (shown.includes(id)) try { r.fit.fit(); } catch {}
    if (!r.running && !r.exited && !r.starting) start(f.s);
  }
  if (!pageEl.hidden) return;
  /** @param {Element | null} e */
  const outsideTerminals = (e) => !!e && e !== document.body && !e.closest('.xterm');
  if (outsideTerminals(document.activeElement)) return;
  if (outsideTerminals(before) && before instanceof HTMLElement && before.isConnected && before.offsetParent) return before.focus();
  if (L.active) rt.get(L.active)?.term.focus();
}

/** @param {string} id */
function setActive(id) {
  if (L.active === id) return;
  L.active = id;
  const r = rt.get(id);
  if (r) r.attn = false; // you are looking at it now
  const n = visible().length;
  for (const p of viewEl.querySelectorAll('.pane')) if (p instanceof HTMLElement) p.classList.toggle('active', p.dataset.id === id && n > 1);
  renderSide();
  save();
}

// A terminal already in the window is only focused. Otherwise it goes back to the spot it had before it was hidden
// (next to the same neighbour, same side and size) when that neighbour is still shown; if not, a plain click shows
// it alone and Ctrl+click adds it next to the focused pane.
/** @param {string} id @param {boolean} add */
function show(id, add) {
  pageEl.hidden = true; // picking a terminal leaves the settings page
  if (visible().includes(id)) {
    if (zoomed && zoomed !== id) { zoomed = id; L.active = id; return renderView(); } // the maximized pane follows
    setActive(id);
    return rt.get(id)?.term.focus();
  }
  zoomed = null;
  const spot = L.spots?.[id];
  if (spot && visible().includes(spot.sibling)) {
    checkpoint(`show ${findSession(id)?.s.name}`);
    return place(id, spot.sibling, spot.dir, spot.before, spot.ratio);
  }
  if (add) { checkpoint(`add ${findSession(id)?.s.name} to window`); return place(id); }
  if (L.tree && 'dir' in L.tree) checkpoint(`show ${findSession(id)?.s.name}`); // replaces a split layout
  L.tree = { id };
  L.active = id;
  renderView();
}

// Shows a terminal picked from outside the sidebar (switcher, note, notification), ending a multi-selection.
/** @param {string} id */
function reveal(id) {
  clearSelection();
  show(id, false);
}

/** @param {string} id */
function hide(id) {
  checkpoint(`hide ${findSession(id)?.s.name ?? 'pane'}`);
  const spot = spotOf(L.tree, id);
  if (spot) (L.spots ??= {})[id] = spot; // remembered so it can come back to the same place
  L.tree = without(L.tree, id);
  zoomed = null;
  renderView();
}

// Puts these terminals in the window together, as a grid; like picking one terminal, it leaves the settings page.
/** @param {string[]} ids */
function showGrid(ids) {
  pageEl.hidden = true;
  zoomed = null;
  L.tree = ids.length ? grid(ids) : null;
  L.active = ids[0] ?? null;
  renderView();
}

/** @param {'row' | 'col'} dir */
function splitActive(dir) {
  if (!L.active) return;
  const f = findSession(L.active);
  if (f && visible().includes(L.active)) newSession(f.g, groupProfile(f.g), { target: L.active, dir });
}

function cycle() {
  const ids = visible();
  if (ids.length > 1) {
    const next = ids[((L.active ? ids.indexOf(L.active) : -1) + 1) % ids.length];
    if (zoomed) return show(next, false);
    setActive(next);
    return rt.get(next)?.term.focus();
  }
  const all = allSessions(), i = all.findIndex((s) => s.id === L.active);
  if (all.length) show(all[(i + 1) % all.length].id, false);
}

// Alt+arrow: to the nearest pane in that direction (by where the panes are on screen). False when there is none.
/** @param {string} key */
function focusDir(key) {
  const active = L.active;
  if (zoomed || !active || !visible().includes(active)) return false;
  const [dx, dy] = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] })[key];
  const mid = (/** @type {string} */ id) => { const r = /** @type {Runtime} */ (rt.get(id)).pane.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const [x0, y0] = mid(active);
  let best = null, bestD = Infinity;
  for (const id of visible()) {
    const [x, y] = mid(id), along = (x - x0) * dx + (y - y0) * dy, across = Math.abs((x - x0) * dy + (y - y0) * dx);
    if (id === active || along <= 1) continue;
    const d = along + 2 * across; // straight ahead beats diagonal
    if (d < bestD) { best = id; bestD = d; }
  }
  if (!best) return false;
  setActive(best);
  rt.get(best)?.term.focus();
  return true;
}

// Ctrl+Shift+D: a new terminal like the focused one (same profile and folder) next to it.
function duplicate() {
  if (!L.active) return;
  const f = findSession(L.active);
  if (f && visible().includes(L.active)) newSession(f.g, profileOf(f.s), { target: L.active, dir: widerDir(L.active) }, undefined, f.s.cwd);
}
