// The frameless window: title bar buttons, full screen, sidebar width.

// The sidebar width is draggable within limits; double-click the edge to reset.
const SIDE = { min: 180, max: 420, default: 240 };
/** @param {number} w */
function setSideWidth(w) {
  L.sideWidth = Math.round(Math.min(SIDE.max, Math.max(SIDE.min, w)));
  document.documentElement.style.setProperty('--side-w', `${L.sideWidth}px`);
  try { localStorage.setItem('sideWidth', String(L.sideWidth)); } catch {}
}
// applied straight away from the per-window copy, so the sidebar does not jump once layout.json is loaded
try { const w = Number(localStorage.getItem('sideWidth')); if (w) document.documentElement.style.setProperty('--side-w', `${w}px`); } catch {}
const sideGutter = $('#side-gutter');
sideGutter.ondblclick = () => { setSideWidth(SIDE.default); save(); };
sideGutter.onmousedown = (e) => drag(e, 'row', (/** @type {MouseEvent} */ ev) => setSideWidth(ev.clientX));

// Frameless window: own title bar buttons; F11 or the sidebar button toggles full screen (title bar hidden).
const win = window.__TAURI__.window.getCurrentWindow();
async function syncChrome() {
  const [max, fs] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
  $('[data-win="max"]').innerHTML = icon(max ? 'restore' : 'max');
  $('[data-win="max"]').title = max ? 'Restore' : 'Maximize';
  for (const b of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-fs-btn]'))) {
    b.innerHTML = icon(fs ? 'exitFullscreen' : 'fullscreen', Number(b.dataset.iconSize ?? 16));
    b.title = fs ? 'Exit full screen (F11)' : 'Full screen (F11)';
  }
  document.documentElement.classList.toggle('fullscreen', fs);
}
// Going full screen from maximized leaves the webview at the maximized height (a taskbar-sized empty strip at the
// bottom of this frameless window). Un-maximize first, then size the window to the monitor explicitly so the
// webview is laid out again; maximize again when leaving full screen.
let maxBeforeFullscreen = false;

async function toggleFullscreen() {
  if (await win.isFullscreen()) {
    await win.setFullscreen(false);
    if (maxBeforeFullscreen) await win.maximize();
  } else {
    maxBeforeFullscreen = await win.isMaximized();
    if (maxBeforeFullscreen) {
      await win.unmaximize();
      for (let i = 0; i < 20 && (await win.isMaximized()); i++) await pause(25);
    }
    await win.setFullscreen(true);
    const m = await window.__TAURI__.window.currentMonitor();
    if (m) {
      await pause(50);
      await win.setPosition(m.position);
      await win.setSize(m.size);
    }
  }
  syncChrome();
}
// In full screen the title bar slides in when the mouse nears the top edge and hides once it moves away. The top
// ~8 px are the frameless window's resize border and deliver no mouse events, so the trigger zone reaches below it.
document.addEventListener('mousemove', (e) => {
  if (!document.documentElement.classList.contains('fullscreen')) return;
  const tb = $('#titlebar');
  if (e.clientY <= 16) tb.classList.add('reveal');
  else if (!tb.contains(/** @type {Node | null} */ (e.target)) && e.clientY > tb.offsetHeight + 12) tb.classList.remove('reveal');
});
$('#titlebar').addEventListener('click', (e) => {
  const act = /** @type {Element} */ (e.target).closest('[data-win]')?.getAttribute('data-win');
  if (act === 'fullscreen') toggleFullscreen();
  else if (act === 'min') win.minimize();
  else if (act === 'max') win.toggleMaximize();
  else if (act === 'close') win.close();
});
win.onResized(syncChrome);
syncChrome();
