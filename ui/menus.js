// The right-click menus: profile picker, colors, group menu, and the menu inside a terminal.

// Shows the menu at (left, top), kept inside the window; it is zoomed with the interface, so it is placed in
// zoomed pixels.
/** @param {number} left @param {number} top */
function showMenu(left, top) {
  menuEl.hidden = false;
  const { width, height } = menuEl.getBoundingClientRect(), z = (L.uiZoom ?? 100) / 100;
  menuEl.style.left = `${Math.max(4, Math.min(left, innerWidth - width - 8)) / z}px`;
  menuEl.style.top = `${Math.max(4, Math.min(top, innerHeight - height - 8)) / z}px`;
}
/** @typedef {{ x: number, y: number }} MenuAt where a menu opens, in window pixels */
/** @typedef {(p: Profile, e: MouseEvent, n: number) => unknown} PickProfile opens profile p, n terminals at once */
const swatches = (/** @type {string | undefined} */ current) => `<div class="swatches">${COLORS.map((c) => `<button data-color="${c}" class="${c === current ? 'on' : ''}" style="--c:${c}" title="${c}"></button>`).join('')}
    <button data-color="" class="none${current ? '' : ' on'}" title="No color">${icon('x', 12)}</button></div>`;
// Right click on a group row: its color, and a way to its profile and folder in Settings > Groups.
/** @param {MenuAt} at @param {Group} g */
function openGroupMenu(at, g) {
  menuEl.innerHTML = `${swatches(g.color)}<button data-gs>${progIcon(groupProfile(g).name, 16)}<span>Profile and folder…
    <small>${esc(groupProfile(g).name)}${g.cwd ? ` · ${esc(g.cwd)}` : ''}</small></span></button>`;
  showMenu(at.x, at.y);
  menuEl.onclick = (e) => {
    const t = /** @type {Element} */ (e.target), c = /** @type {HTMLElement | null} */ (t.closest('[data-color]')), gs = t.closest('[data-gs]');
    if (c || gs) menuEl.hidden = true;
    if (gs) return openSettings(`#group-${g.id}`);
    if (!c) return;
    checkpoint(`color of ${g.name}`);
    g.color = c.dataset.color || undefined;
    renderView();
  };
}

// Right click on a terminal row: its color, and whether it comes to the front when it is done (attention.js).
/** @param {MenuAt} at @param {Session} s */
function openSessionMenu(at, s) {
  menuEl.innerHTML = `${swatches(s.color)}<button data-front>${icon('bell', 16)}<span>${s.front ? '✓ ' : ''}Bring to front when done
    <small>Shows it and brings Werkbank forward</small></span></button>`;
  showMenu(at.x, at.y);
  menuEl.onclick = (e) => {
    const t = /** @type {Element} */ (e.target), c = /** @type {HTMLElement | null} */ (t.closest('[data-color]')), fr = t.closest('[data-front]');
    if (!c && !fr) return;
    menuEl.hidden = true;
    checkpoint(`${fr ? 'bring to front' : 'color'} ${s.name}`);
    if (fr) s.front = !s.front || undefined;
    else s.color = c?.dataset.color || undefined;
    renderView();
  };
}

// Buttons that open a terminal: left click = default profile (of the group), right click = profile menu.
/** @param {HTMLElement} el @param {PickProfile} open @param {() => Profile} [dflt] */
function newTerminalButton(el, open, dflt = defaultProfile) {
  el.onclick = (e) => { e.stopPropagation(); open(dflt(), e, 1); };
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, open); };
}

// Profile picker at the mouse (right click on a + button); the count row on top opens several terminals at once,
// tiled (4 = 2×2).
/** @param {MenuAt} at @param {PickProfile} pick */
function openMenu(at, pick) {
  const n = L.openCount ?? 1;
  menuEl.innerHTML = `<div class="mcount"><span>Open</span>${[1, 2, 3, 4, 6, 8]
    .map((k) => `<button data-n="${k}" class="${k === n ? 'on' : ''}">${k}</button>`).join('')}</div>`
    + profiles.map((p, i) => `<button data-i="${i}">${progIcon(p.name, 16)}<span>${esc(p.name)}</span></button>`).join('');
  showMenu(at.x, at.y);
  menuEl.onclick = (e) => {
    const b = /** @type {Element} */ (e.target).closest('button');
    if (b?.dataset.n) { // only mark the count, the menu stays open
      L.openCount = Number(b.dataset.n);
      for (const x of menuEl.querySelectorAll('[data-n]')) x.classList.toggle('on', x === b);
      return save();
    }
    const i = b?.dataset.i;
    if (i === undefined) return;
    menuEl.hidden = true;
    pick(profiles[Number(i)], e, L.openCount ?? 1);
  };
}

document.addEventListener('mousedown', (e) => { if (!menuEl.contains(/** @type {Node} */ (e.target))) menuEl.hidden = true; });

// The clipboard through Tauri: the browser's own clipboard read needs a focused page and may ask for permission.
const clipboard = window.__TAURI__.clipboardManager;
// Windows lets one program at a time open the clipboard, and clipboard managers or password managers hold it for a
// moment after every change: try again for up to a second, as Windows Terminal and .NET do, instead of losing it.
/** @template T @param {() => Promise<T>} op @returns {Promise<T>} */
async function withClipboard(op) {
  for (let i = 0; ; i++) {
    try {
      return await op();
    } catch (e) {
      if (i === 19) throw e;
      await pause(50);
    }
  }
}
/** @param {import('@xterm/xterm').Terminal} term */
async function copySelection(term) {
  await withClipboard(() => clipboard.writeText(term.getSelection())).catch((e) => log('copy failed:', e));
  term.clearSelection();
}
/** @param {import('@xterm/xterm').Terminal} term */
async function pasteInto(term) {
  term.paste(await withClipboard(() => clipboard.readText()).catch((e) => { log('paste failed:', e); return ''; }));
}
// Right click in a terminal: copy / paste / find / split / hide.
/** @param {Session} s @param {Runtime} r @param {MenuAt} at */
function terminalMenu(s, r, at) {
  const sel = r.term.hasSelection(), item = (/** @type {string} */ a, /** @type {string} */ ic, /** @type {string} */ text, /** @type {boolean} */ off = false) => `<button data-a="${a}"${off ? ' disabled' : ''}>${icon(ic)}<span>${text}</span></button>`;
  menuEl.innerHTML = item('copy', 'copy', 'Copy', !sel) + item('paste', 'paste', 'Paste') + item('find', 'search', 'Find… (Ctrl+Shift+F)')
    + item('row', 'splitRight', 'Split right') + item('col', 'splitDown', 'Split down') + item('hide', 'x', 'Hide from view');
  showMenu(at.x, at.y);
  menuEl.onclick = async (e) => {
    const a = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-a]'))?.dataset.a;
    if (!a) return;
    menuEl.hidden = true;
    if (a === 'copy') await copySelection(r.term);
    else if (a === 'paste') await pasteInto(r.term);
    else if (a === 'find') return openFind(r);
    else if (a === 'hide') return hide(s.id);
    else { const f = findSession(s.id); return f && newSession(f.g, groupProfile(f.g), { target: s.id, dir: /** @type {'row' | 'col'} */ (a) }); } // gone if it was closed while the menu was open
    r.term.focus();
  };
}
