// Keyboard shortcuts and the go-to-terminal box (Ctrl+Shift+P).

// Ctrl+Shift+P: go to a terminal by typing part of its name, its topic or its group.
function openSwitcher() {
  let box = $('#switcher');
  if (!box) {
    box = document.createElement('div');
    box.id = 'switcher';
    box.innerHTML = '<input placeholder="Go to terminal…" spellcheck="false"><div class="sw-list"></div>';
    document.body.append(box);
  }
  // the box is made with both just above
  const inp = /** @type {HTMLInputElement} */ (box.querySelector('input')), list = /** @type {HTMLElement} */ (box.querySelector('.sw-list'));
  const all = groupTree(L.groups).flatMap(({ g }) => g.sessions.map((s) => ({ s, g })));
  /** @type {{ s: Session, g: Group }[]} */
  let hits = [], i = 0;
  const render = () => {
    const words = inp.value.toLowerCase().split(/\s+/).filter(Boolean);
    hits = all.filter(({ s, g }) => words.every((w) => `${label(s)} ${s.name} ${groupPath(L.groups, g)}`.toLowerCase().includes(w)));
    i = Math.max(0, Math.min(i, hits.length - 1));
    list.innerHTML = hits.map(({ s, g }, k) => {
      const st = dotState(rt.get(s.id));
      return `<button data-k="${k}" class="${st}${k === i ? ' on' : ''}"><span class="dot" title="${DOTS[st]}"></span>${progIcon(s.profile, 16)}<span>${esc(label(s))}</span><small>${esc(g.name)}</small></button>`;
    }).join('') || '<p>No terminal matches</p>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { box.hidden = true; };
  const go = (/** @type {number} */ k) => {
    const h = hits[k];
    close();
    if (h) reveal(h.s.id); else if (L.active) rt.get(L.active)?.term.focus();
  };
  inp.value = '';
  box.hidden = false;
  render();
  inp.focus();
  inp.oninput = () => { i = 0; render(); };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) i = (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      render();
    } else if (e.key === 'Enter') go(i);
    else if (e.key === 'Escape') { e.stopPropagation(); go(-1); }
  };
  inp.onblur = close;
  // mousedown, not click: the input's blur would close the list before the click lands
  list.onmousedown = (e) => { const b = e.target instanceof Element ? e.target.closest('[data-k]') : null; if (b instanceof HTMLElement) { e.preventDefault(); go(Number(b.dataset.k)); } };
}

// Returns true when the key was handled here and must not reach the terminal.
/** @param {KeyboardEvent} e @param {import('@xterm/xterm').Terminal | null} term @returns {boolean} */
function shortcut(e, term) {
  if (e.type !== 'keydown') return false;
  if (e.key === 'F11') { toggleFullscreen(); e.preventDefault(); return true; }
  if (e.altKey && e.shiftKey && !e.ctrlKey && ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(e.code)) {
    splitActive(e.code === 'Equal' || e.code === 'NumpadAdd' ? 'row' : 'col');
    e.preventDefault();
    return true;
  }
  // Ctrl+Shift+B, not Ctrl+B: that is the tmux prefix and must reach the terminal
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyB') { toggleSide(); e.preventDefault(); return true; }
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
    if (L.active && visible().includes(L.active)) openFind(/** @type {Runtime} */ (rt.get(L.active))); // a shown pane has its runtime
    e.preventDefault();
    return true;
  }
  const ctrlShift = /** @type {Record<string, (() => void) | undefined>} */ ({ KeyP: openSwitcher, Enter: toggleZoom, NumpadEnter: toggleZoom, KeyD: duplicate })[e.code];
  if (e.ctrlKey && e.shiftKey && !e.altKey && ctrlShift) { ctrlShift(); e.preventDefault(); return true; }
  if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.shiftKey) { renameActive(); e.preventDefault(); return true; }
  // Alt+arrow moves between panes; with a single pane the terminal gets it (shells use it to jump words)
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.startsWith('Arrow') && focusDir(e.key)) { e.preventDefault(); return true; }
  if (e.ctrlKey && e.shiftKey && !e.altKey && ['Equal', 'Minus', 'Digit0'].includes(e.code)) {
    const i = ZOOMS.indexOf(L.uiZoom ?? 100);
    setZoom(e.code === 'Digit0' ? 100 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + (e.code === 'Equal' ? 1 : -1)))]);
    e.preventDefault();
    return true;
  }
  if (!e.ctrlKey || e.altKey || e.shiftKey) return false;
  if (['Equal', 'Minus', 'Digit0'].includes(e.code)) {
    setFont(e.code === 'Digit0' ? 14 : L.fontSize + (e.code === 'Equal' ? 1 : -1));
    e.preventDefault();
    return true;
  }
  if (/^[1-9]$/.test(e.key)) { const s = allSessions()[Number(e.key) - 1]; if (s) reveal(s.id); e.preventDefault(); return true; }
  if (e.key === 'Tab') { cycle(); e.preventDefault(); return true; }
  if (!term) return false;
  if (e.key.toLowerCase() === 'v') return true; // let the browser paste event deliver the clipboard text to xterm
  if (e.key.toLowerCase() === 'c' && term.hasSelection()) { copySelection(term); return true; }
  return false;
}
// Keys outside the terminals (inside one, xterm's handler calls `shortcut` and Esc / Delete belong to the program).
window.addEventListener('keydown', (e) => {
  const t = e.target instanceof Element ? e.target : null; // or the window / document
  if (t?.closest('.xterm')) return;
  const typing = !!t?.closest('input, select'), ctrl = e.ctrlKey && !e.shiftKey && !e.altKey;
  if (!typing && ctrl && e.code === 'KeyZ') { e.preventDefault(); return undo(); }
  if (!typing && ctrl && e.code === 'KeyA') { // select all
    e.preventDefault();
    const all = sidebarOrder();
    return selectRange(all[0], all[all.length - 1], false);
  }
  if (!typing && e.key === 'Delete' && selected.size) return closeSelected(true);
  if (e.key === 'Escape') {
    if (clearSelection()) return;
    if (!pageEl.hidden) return closeSettings();
    if (document.documentElement.classList.contains('fullscreen')) return toggleFullscreen();
  }
  shortcut(e, null);
});
$('#undo').onclick = undo;
$('#sidetoggle').onclick = toggleSide;
$('#sideopen').onclick = () => setSideMode('open');
