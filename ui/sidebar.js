// The sidebar: groups and terminals, selecting, renaming, dragging, and its buttons.

// Stopping terminals needs a second click within 3 s (so one stray click can't kill a Claude session): the first
// click arms the button (shown red) and returns false, the second returns true.
/** @param {string} key */
function confirmed(key) {
  if (armed === key) { armed = null; return true; }
  armed = key;
  renderSide();
  setTimeout(() => { if (armed === key) { armed = null; renderSide(); } }, 3000);
  return false;
}

// Multi-select in the sidebar (Ctrl/Shift+click, like Explorer): show the selected terminals together, or stop them.
// Lives in memory only; terminals in locked groups are never stopped.
/** @type {Set<string>} */
const selected = new Set();
/** @param {string} id */
function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // take the keyboard out of the terminal, so Delete / Esc reach the selection
  renderSide();
}
function clearSelection() {
  if (!selected.size) return false;
  selected.clear();
  if (armed === 'sel' || armed === 'del') armed = null;
  renderSide();
  return true;
}
// The button asks twice and keeps terminals in locked groups. The Delete key stops them at once, like deleting in
// Explorer (Ctrl+Z brings them back); with terminals of a locked group in the selection it asks twice (Delete, Delete
// within 3 s) and then stops those too.
/** @param {string[]} ids */
function stopSelected(ids) {
  checkpoint(`close ${ids.length} selected`);
  dropFromGroups(ids);
  for (const id of ids) selected.delete(id); // locked ones the button kept stay selected
  renderView();
}
const lockedSel = () => [...selected].filter((id) => { const f = findSession(id); return f && isLocked(L.groups, f.g); });
function closeSelected() {
  const kept = lockedSel(), ids = [...selected].filter((id) => findSession(id) && !kept.includes(id));
  if (ids.length && confirmed('sel')) stopSelected(ids); // all in locked groups: nothing to stop
}
function deleteSelected() {
  const ids = [...selected].filter((id) => findSession(id));
  if (ids.length && (!lockedSel().length || confirmed('del'))) stopSelected(ids);
}

function showSelected() {
  const ids = [...selected].filter((id) => findSession(id));
  if (!ids.length) return;
  checkpoint(`show ${ids.length} selected`);
  showGrid(ids);
}
function renderSelbar() {
  const bar = $('#selbar');
  for (const id of [...selected]) if (!findSession(id)) selected.delete(id);
  bar.hidden = !selected.size;
  if (!selected.size) return;
  const sure = armed === 'sel', locked = lockedSel().length, again = armed === 'del';
  const stop = locked === selected.size
    ? `<button disabled title="These terminals are in a locked group: press Delete twice to stop them anyway">${icon('lock', 14)}</button>`
    : `<button data-sel="close" class="${sure ? 'armed' : ''}" title="${sure ? 'Click again to stop them' : 'Stop and remove them (Delete · Ctrl+Z undoes)'}${locked ? ` · ${locked} in a locked group are kept (Delete twice stops them too)` : ''}">${icon('trash', 14)}</button>`;
  bar.innerHTML = `<span${again ? ' class="armed"' : ''}>${again ? `Delete again: also stops ${locked} locked` : `${selected.size} selected${locked ? ` · ${locked} locked` : ''}`}</span>
    <button data-sel="show" title="Show them side by side">${icon('grid', 14)}</button>
    ${stop}
    <button data-sel="clear" title="Clear selection (Esc)">${icon('x', 14)}</button>`;
}
$('#selbar').addEventListener('click', (e) => {
  const act = closestEl(e.target, '[data-sel]')?.dataset.sel;
  if (act === 'show') showSelected();
  else if (act === 'close') closeSelected();
  else if (act === 'clear') clearSelection();
});

// busy / done: only after a program reported work (Claude); `working` stays undefined for a shell, which stays running
/** @param {Session} s */
const dotState = (s, r = rt.get(s.id)) => (r?.attn ? 'attn' : asleep(s) ? 'asleep' : r?.exited ? 'exited' : r?.working ? 'busy'
  : r?.running && r.working === false ? 'done' : r?.unread ? 'unread' : r?.running ? 'running' : 'idle');
// What the status dot in front of a terminal means (its tooltip).
const DOTS = {
  running: 'Running',
  busy: 'Working',
  done: 'Not working: finished or waiting for you',
  unread: 'New output since you last looked',
  attn: 'Needs your attention: just finished, or rang its bell',
  exited: 'Stopped: show it and press Enter to restart',
  idle: 'Not started yet: starts when you show it',
  asleep: 'Asleep: stopped to free memory, continues its conversation when you show it',
};
// The status mark in front of a terminal (sidebar, go-to box): a shape per state, not only a color, so it also reads on
// a group's glow.
const dotHtml = (/** @type {keyof typeof DOTS} */ st) => `<span class="dot" title="${DOTS[st]}">${st === 'done' ? icon('check', 12) : st === 'asleep' ? icon('moon', 12) : ''}</span>`;
// the tooltip of a terminal row: its name and what its program uses (memory.js)
const rowTitle = (/** @type {Session} */ s) => { const m = rt.get(s.id)?.mem; return `${esc(label(s))}${s.tag ? ` · ${esc(s.tag)}` : ''}${m ? ` · ${bytes(m)}` : ''}${s.awake ? ' · kept awake' : ''}`; };
// a terminal's label (`werkbank label`), next to its name in the sidebar and the go-to box
const tagHtml = (/** @type {Session} */ s) => (s.tag ? `<span class="stag">${esc(s.tag)}</span>` : '');
const hasSubgroups = (/** @type {Group} */ g) => L.groups.some((x) => x.parent === g.id);
// a group row folds when there is something under it: terminals or subgroups
const foldable = (/** @type {Group} */ g) => g.sessions.length > 0 || hasSubgroups(g);
function renderSide() {
  if (editing) return;
  const inView = visible();
  let fold = Infinity; // rows deeper than this belong to a folded group and are not drawn
  const rows = groupTree(L.groups).filter(({ g, depth }) => {
    if (depth > fold) return false;
    fold = g.collapsed && foldable(g) ? depth : Infinity;
    return true;
  });
  // per depth: the top-most and the nearest color of the groups above, so a subgroup continues their glow
  /** @type {(string | undefined)[]} */
  const top = [];
  /** @type {(string | undefined)[]} */
  const near = [];
  groupsEl.innerHTML = rows.map(({ g, depth }, i) => {
    const below = subtree(L.groups, g), all = below.flatMap((x) => x.sessions), locked = isLocked(L.groups, g);
    const band = depth ? top[depth - 1] : undefined, color = g.color || (depth ? near[depth - 1] : undefined);
    top[depth] = band || g.color;
    near[depth] = color;
    const next = rows[i + 1], joined = `${band ? ' joined-top' : ''}${next?.depth && top[next.depth - 1] ? ' joined-bottom' : ''}`;
    const own = band && color !== band ? ' own' : '';
    return `
    <div class="group${g.collapsed && foldable(g) ? ' collapsed' : ''}${joined}${own}" data-g="${g.id}" style="--d:${depth}${color ? `;--gc:${color}` : ''}${band ? `;--tc:${band}` : ''}">
      <div class="ghead${foldable(g) ? ' has' : ''}${all.some((s) => rt.get(s.id)?.attn) ? ' attn' : ''}" title="${esc(groupPath(L.groups, g))}${g.profile || g.cwd ? ` · new terminals: ${esc(groupProfile(g).name)}${g.cwd ? ` in ${esc(g.cwd)}` : ''}` : ''}">
        <span class="caret">${foldable(g) ? icon('chevron', 14) : ''}</span>${g.color ? `<i class="gdot" style="background:${g.color}"></i>` : ''}<span class="gname">${esc(g.name)}</span><span class="ginit">${esc((g.name.trim()[0] ?? '?').toUpperCase())}</span>
        ${g.locked ? `<span class="glock" title="Locked: this group, its subgroups and their terminals cannot be removed">${icon('lock', 13)}</span>` : ''}
        <span class="count">${all.length || ''}</span>
        <span class="gacts">
          <button data-act="lock" class="${g.locked ? 'on' : ''}" title="${g.locked ? 'Locked: click to unlock' : 'Lock group: it, its subgroups and their terminals cannot be removed'}">${icon(g.locked ? 'lock' : 'unlock', 14)}</button>
          <button data-act="tile" title="Show the whole group">${icon('grid', 14)}</button>
          <button data-act="add" title="New terminal · right-click: choose">${icon('plus', 14)}</button>
          <button data-act="subgroup" title="New group inside this group">${icon('folderPlus', 14)}</button>
          ${below.some((x) => x.sessions.length && !isLocked(L.groups, x)) ? `<button data-act="closeall" class="${armed === `g:${g.id}` ? 'armed' : ''}" title="${armed === `g:${g.id}` ? 'Click again to stop all its terminals' : 'Close all terminals in this group'}">${icon('trash', 14)}</button>` : ''}
          ${below.length > 1 || all.length || locked ? '' : `<button data-act="delgroup" title="Delete empty group">${icon('trash', 14)}</button>`}
        </span>
      </div>
      <div class="sessions">${g.sessions.map((s) => {
        const r = rt.get(s.id);
        const st = dotState(s, r);
        const confirm = armed === s.id;
        return `<div class="sess ${st}${inView.includes(s.id) ? ' visible' : ''}${s.id === L.active ? ' active' : ''}${confirm ? ' confirm' : ''}${selected.has(s.id) ? ' selected' : ''}" data-s="${s.id}" title="${rowTitle(s)}"${s.color ? ` style="--sc:${s.color}"` : ''}>
          ${dotHtml(st)}${progIcon(s.profile, 15)}<span class="sname">${esc(label(s))}</span>${tagHtml(s)}${s.front ? `<span class="sfront" title="Comes to the front when done">${icon('bell', 12)}</span>` : ''}
          ${locked ? '' : `<button data-act="close" class="${confirm ? 'armed' : ''}" title="${confirm ? 'Click again to stop' : 'Stop and remove terminal'}">${icon('trash', 14)}</button>`}</div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
  renderSelbar();
  updateBadge();
}

/**
 * @param {Element} el
 * @param {{ name: string, custom?: boolean }} obj a group or a session
 * @param {string} [current]
 */
function rename(el, obj, current = obj.name) {
  const inp = document.createElement('input');
  inp.value = current;
  el.replaceWith(inp);
  editing = true;
  inp.focus();
  inp.select();
  const done = (/** @type {boolean} */ ok) => {
    if (!editing) return;
    editing = false;
    if (ok && inp.value.trim() && inp.value.trim() !== current) {
      checkpoint(`rename ${current}`);
      obj.name = inp.value.trim();
      if (!('sessions' in obj)) obj.custom = true; // a name you typed wins over the title the program sets
    }
    renderView();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  inp.onblur = () => done(true);
}

groupsEl.addEventListener('click', (e) => {
  if (dragged) return;
  const sess = closestEl(e.target, '.sess'), gEl = closestEl(e.target, '.group');
  const g = gEl && L.groups.find((x) => x.id === gEl.dataset.g);
  if (!g) return; // every row and button lives in a group
  const actEl = closestEl(e.target, '[data-act]');
  if (actEl?.dataset.act === 'close') {
    const id = sess?.dataset.s;
    if (!id) return;
    if ((rt.get(id)?.running || rt.get(id)?.starting) && !confirmed(id)) return; // a stopped one goes on the first click
    return removeSession(id);
  }
  if (actEl?.dataset.act) return groupAct(g, actEl.dataset.act, e);
  // the group row folds open/closed, but only when there is something in it
  if (closestEl(e.target, '.ghead') && !actEl) {
    if (e.target instanceof HTMLInputElement) return; // typing a name
    // a double click on the name renames. It is handled here, not as a dblclick: the first click already redrew the row
    // (folding it), so the browser's dblclick would land on an element that is gone. Undo that first fold.
    if (e.detail === 2 && closestEl(e.target, '.gname')) {
      if (foldable(g)) { g.collapsed = !g.collapsed; renderSide(); save(); }
      const el = groupsEl.querySelector(`[data-g="${g.id}"] .gname`);
      return el && rename(el, g);
    }
    if (!foldable(g)) return;
    g.collapsed = !g.collapsed;
    renderSide();
    return save();
  }
  // Explorer-style: click shows it (and clears the selection), Ctrl+click toggles it in the selection,
  // Shift+click selects the range from the last clicked one, Ctrl+Shift+click adds that range.
  const id = sess?.dataset.s;
  if (!id) return;
  if (e.shiftKey) return selectRange(anchor ?? L.active ?? id, id, e.ctrlKey);
  anchor = id;
  if (e.ctrlKey) return toggleSelect(id);
  clearSelection();
  show(id, false);
});
// What the buttons on a group row and its right-click menu do. Stopping running terminals takes a second click
// (`confirmed`); the caller can tell by `armed` still holding the key ('g:' close all, 'd:' delete).
/** @param {Group} g @param {string} act @param {MouseEvent} e */
function groupAct(g, act, e) {
  switch (act) {
    case 'add': return addToGroup(g)(groupProfile(g), e, 1);
    case 'tile': {
      checkpoint(`show group ${g.name}`);
      return showGrid(subtree(L.groups, g).flatMap((x) => x.sessions.map((s) => s.id)));
    }
    case 'subgroup': return newGroup(g);
    case 'rename': {
      const el = groupsEl.querySelector(`[data-g="${g.id}"] .gname`);
      return el && rename(el, g);
    }
    case 'closeall': return confirmed(`g:${g.id}`) && closeGroup(g);
    case 'delgroup': { // with its subgroups and terminals; one undo step brings it all back
      const below = subtree(L.groups, g);
      if (below.some((x) => isLocked(L.groups, x))) return;
      if (below.some((x) => x.sessions.some((s) => rt.get(s.id)?.running || rt.get(s.id)?.starting)) && !confirmed(`d:${g.id}`)) return;
      checkpoint(`delete group ${g.name}`);
      for (const x of below) for (const s of x.sessions) drop(s.id);
      L.groups = L.groups.filter((x) => !below.includes(x));
      return renderView();
    }
    case 'lock':
      checkpoint(`${g.locked ? 'unlock' : 'lock'} ${g.name}`);
      g.locked = !g.locked;
      armed = null;
      renderSide();
      return save();
  }
}

/** @type {string | null} */
let anchor = null;
// the terminals in the order shown in the sidebar, skipping those of folded groups
const sidebarOrder = () => [.../** @type {NodeListOf<HTMLElement>} */ (groupsEl.querySelectorAll('.sess'))].filter((el) => el.offsetParent).map((el) => /** @type {string} */ (el.dataset.s));
/** @param {string} from @param {string} to @param {boolean} add */
function selectRange(from, to, add) {
  const order = sidebarOrder();
  let i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0) i = j;
  if (!add) selected.clear();
  for (const x of order.slice(Math.min(i, j), Math.max(i, j) + 1)) selected.add(x);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  renderSide();
}

const addToGroup = (/** @type {Group} */ g) => (/** @type {Profile} */ p, /** @type {MouseEvent} */ ev, /** @type {number} */ n) => (n > 1 ? openMany(g, p, n)
  : newSession(g, p, ev.ctrlKey && { target: L.active, dir: widerDir(L.active ?? '') }));
// the group + buttons are re-rendered, so their right click is delegated here
groupsEl.addEventListener('contextmenu', (e) => {
  const add = closestEl(e.target, '[data-act="add"]');
  if (!add) {
    const sessEl = closestEl(e.target, '.sess'), gEl = closestEl(e.target, '.group');
    if (!gEl) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    const g = L.groups.find((x) => x.id === gEl.dataset.g), f = findSession(sessEl?.dataset.s ?? '');
    if (!sessEl) return g && openGroupMenu(at, g);
    return f && openSessionMenu(at, f.s);
  }
  e.preventDefault();
  const g = L.groups.find((x) => x.id === closestEl(add, '.group')?.dataset.g);
  if (g) openMenu({ x: e.clientX, y: e.clientY }, addToGroup(g));
});

groupsEl.addEventListener('dblclick', (e) => {
  const sname = closestEl(e.target, '.sname');
  if (sname) { const f = findSession(closestEl(sname, '.sess')?.dataset.s ?? ''); if (f) rename(sname, f.s, label(f.s)); }
});

// Dragging in the sidebar, done with plain mouse events: HTML drag and drop belongs to Tauri on Windows, which
// uses it for files dropped from Explorer (below). Drag a group row above/below another group; drag a terminal
// above/below another terminal (also across groups), onto a group row to append it there, or onto a pane edge to
// split that pane with it. A pane dragged by its title (like in VS Code) lands on another pane's edge, or in its
// middle to swap the two.
const area = viewEl.parentElement;
// the element at t or its ancestor matching a selector; only used with selectors of the sidebar / pane HTML (HTML elements)
const closestEl = (/** @type {EventTarget | null | undefined} */ t, /** @type {string} */ sel) => /** @type {HTMLElement | null} */ (t instanceof Element ? t.closest(sel) : null);
const clearDrop = () => {
  document.querySelectorAll('.drop').forEach((d) => d.classList.remove('drop'));
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-drop]')).forEach((d) => delete d.dataset.drop);
};
/** @param {MouseEvent} e @param {HTMLElement} pane @param {boolean} [middle] */
function edge(e, pane, middle) {
  const r = pane.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const [side, d] = /** @type {[string, number][]} */ ([['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]]).sort((p, q) => p[1] - q[1])[0];
  return middle && d > 0.25 ? 'center' : side;
}
const half = (/** @type {MouseEvent} */ e, /** @type {HTMLElement} */ el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'before' : 'after'; };
// On a group's row: the top / bottom quarter puts a dragged group before / after it, the middle puts it inside it.
// Below the row (over its terminals) counts as the bottom.
const groupZone = (/** @type {MouseEvent} */ e, /** @type {HTMLElement} */ t) => {
  const r = (t.querySelector('.ghead') ?? t).getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
};
// Where a dragged group / terminal would land under the mouse, with the marker shown; null = nowhere.
/** @param {MouseEvent} e @param {string} kind @param {string} id */
function dropTarget(e, kind, id) {
  clearDrop();
  const at = document.elementFromPoint(e.clientX, e.clientY);
  const t = closestEl(at, '.group'), sess = closestEl(at, '.sess'), pane = closestEl(at, '.pane');
  if (kind === 'group') {
    const moving = L.groups.find((x) => x.id === id), target = L.groups.find((x) => x.id === t?.dataset.g);
    if (!t || !moving || !target || inside(L.groups, target, moving)) return null; // not onto itself or into its own subgroup
    const side = groupZone(e, t);
    if (side === 'into') t.classList.add('drop');
    else t.dataset.drop = side;
    return { t, side };
  }
  if (kind === 'pane') return pane && pane.dataset.id !== id ? { pane, side: (pane.dataset.drop = edge(e, pane, true)) } : null;
  if (sess) return { t, sess, side: (sess.dataset.drop = half(e, sess)) };
  if (t) { t.classList.add('drop'); return { t }; }
  if (pane) return { pane, side: (pane.dataset.drop = edge(e, pane)) };
  if (at && area?.contains(at)) { viewEl.classList.add('drop'); return { view: true }; }
  return null;
}
/** @param {string} kind @param {string} id @param {NonNullable<ReturnType<typeof dropTarget>>} d */
function land(kind, id, d) {
  if (kind === 'group') {
    const moving = L.groups.find((x) => x.id === id), target = L.groups.find((x) => x.id === d.t?.dataset.g);
    if (!moving || !target || inside(L.groups, target, moving)) return;
    checkpoint(`move group ${moving.name}`);
    moveGroup(L.groups, moving, target, d.side ?? 'after');
    if (d.side === 'into') target.collapsed = false;
  } else if (d.t) {
    const f = findSession(id), dest = L.groups.find((x) => x.id === d.t?.dataset.g);
    if (!f || !dest || d.sess?.dataset.s === id) return;
    const { g, s } = f;
    checkpoint(`move ${s.name}`);
    g.sessions = g.sessions.filter((x) => x !== s);
    const before = d.sess?.dataset.s;
    if (before) dest.sessions.splice(dest.sessions.findIndex((x) => x.id === before) + (d.side === 'after' ? 1 : 0), 0, s);
    else dest.sessions.push(s);
    dest.collapsed = false;
  } else {
    const target = d.pane?.dataset.id;
    if (target === id) return; // onto itself
    checkpoint(`${kind === 'pane' ? 'move' : 'split with'} ${findSession(id)?.s.name}`);
    if (d.view) return visible().length ? place(id) : show(id, false);
    if (!target) return;
    if (d.side === 'center') {
      L.tree = swap(L.tree, id, target);
      L.active = id;
      return renderView();
    }
    return place(id, target, d.side === 'left' || d.side === 'right' ? 'row' : 'col', d.side === 'left' || d.side === 'top');
  }
  renderSide();
  save();
}
let dragged = false; // the click that ends a drag must not also show / select / fold
/** @param {MouseEvent} e @param {string} kind @param {string} id */
function startDrag(e, kind, id) {
  let moving = false;
  const move = (/** @type {MouseEvent} */ ev) => {
    if (!moving && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
    moving = true;
    document.body.classList.add('dnd');
    dropTarget(ev, kind, id);
  };
  const up = (/** @type {MouseEvent} */ ev) => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    document.body.classList.remove('dnd');
    if (!moving) return;
    dragged = true;
    setTimeout(() => { dragged = false; });
    const d = dropTarget(ev, kind, id);
    clearDrop();
    if (d) land(kind, id, d);
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}
groupsEl.addEventListener('mousedown', (e) => {
  const s = closestEl(e.target, '.sess'), gh = closestEl(e.target, '.ghead');
  if (e.button !== 0 || editing || closestEl(e.target, 'button') || (!s && !gh)) return;
  const id = s ? s.dataset.s : closestEl(gh, '.group')?.dataset.g;
  if (id) startDrag(e, s ? 'sess' : 'group', id);
});
viewEl.addEventListener('mousedown', (e) => {
  const id = closestEl(closestEl(e.target, '.pbar span'), '.pane')?.dataset.id;
  if (e.button !== 0 || !id || zoomed || visible().length < 2) return;
  e.preventDefault(); // no text selection while dragging
  startDrag(e, 'pane', id);
});

const currentGroup = () => findSession(L.active ?? '')?.g ?? L.groups[0];
newTerminalButton($('#empty-new'), (/** @type {Profile} */ p, /** @type {MouseEvent} */ ev, /** @type {number} */ n) => (n > 1 ? openMany(currentGroup(), p, n) : newSession(currentGroup(), p)),
  () => groupProfile(currentGroup()));

$('#showall').onclick = () => {
  checkpoint('show all terminals');
  clearSelection();
  showGrid(allSessions().map((s) => s.id));
};

// A new group at the top level, or inside `parent`; its name is open for typing.
/** @param {Group} [parent] */
function newGroup(parent) {
  checkpoint(parent ? `new group in ${parent.name}` : 'new group');
  /** @type {Group} */
  const g = { id: uid(), name: 'New group', collapsed: false, sessions: [] };
  if (parent) {
    g.parent = parent.id;
    parent.collapsed = false;
  }
  L.groups.push(g);
  save();
  renderSide();
  const el = groupsEl.querySelector(`[data-g="${g.id}"] .gname`);
  if (el) rename(el, g);
}
$('#newgroup').onclick = () => newGroup();

// F2: rename the focused terminal in the sidebar.
function renameActive() {
  const f = L.active && findSession(L.active);
  if (!f) return;
  if (f.g.collapsed) { f.g.collapsed = false; renderSide(); }
  const el = groupsEl.querySelector(`[data-s="${L.active}"] .sname`);
  if (el) rename(el, f.s, label(f.s));
}
