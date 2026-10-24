// A terminal needs you: chime, blinking, Windows notification and the count on the taskbar button.

// A terminal needs attention: optional chime + blinking row/pane + taskbar flash. Skipped for the terminal you
// are looking at in a focused window, unless `test`.
/** @type {AudioContext | undefined} */
let audio;
function chime() {
  const a = (audio ??= new AudioContext()), t0 = a.currentTime;
  [[880, 0], [1320, 0.12]].forEach(([f, dt]) => {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * (L.notifyVolume ?? 50) / 100), t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.25);
    o.connect(g).connect(a.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.3);
  });
}
/** @param {string | null} id null with `test`: the settings test, no terminal @param {boolean} [test] */
function attention(id, test = false) {
  if (!test && id && document.hasFocus() && id === L.active && visible().includes(id)) return;
  if ((L.notifySound && !document.hasFocus()) || test) chime(); // in front you see it; the chime is for when you don't
  // a Windows notification naming the terminal, when you are in another program; clicking it opens that terminal
  const f = id ? findSession(id) : undefined;
  if (L.notifyToast !== false && (test || (f && !document.hasFocus()))) {
    invoke('notify', f ? { id: f.s.id, title: label(f.s), body: `Finished or waiting for you · ${f.g.name}` }
      : { id: '', title: 'Werkbank', body: 'This is how a notification looks' }).catch(console.error);
  }
  if (f) note(f);
  if (f?.s.front && !test) { // set in its right-click menu: it is shown, and Werkbank comes forward
    reveal(f.s.id);
    return invoke('to_front').catch(() => {});
  }
  if (L.notifyFlash === false) return;
  if (!document.hasFocus()) win.requestUserAttention(2).catch(() => {}); // 2 = informational: flash the taskbar button
  const r = id && rt.get(id);
  if (!r) return;
  r.attn = true;
  r.pane.classList.remove('attn');
  void r.pane.offsetWidth; // restart the CSS animation
  r.pane.classList.add('attn');
  renderSide();
}
// The terminal is busy again: take back its blinking, its count on the taskbar and its note.
/** @param {string} id */
function calm(id) {
  const r = rt.get(id);
  if (!r?.attn) return;
  r.attn = false;
  r.pane.classList.remove('attn');
  if (noteEl.dataset.id === id) noteEl.hidden = true;
  renderSide();
}
// A note at the bottom of the window naming the terminal that rang, so a chime is never anonymous; click to show it.
const noteEl = $('#note');
/** @type {ReturnType<typeof setTimeout> | undefined} */
let noteTimer;
/** @param {{ g: Group, s: Session }} f */
function note(f) {
  noteEl.innerHTML = `${icon('bell', 14)}<b>${esc(label(f.s))}</b><span>${esc(f.g.name)} · finished or waiting for you</span>`;
  noteEl.dataset.id = f.s.id;
  noteEl.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { noteEl.hidden = true; }, 8000);
}
noteEl.onclick = () => { noteEl.hidden = true; const id = noteEl.dataset.id; if (id && findSession(id)) reveal(id); };

// The number of terminals that need your attention, as a small badge on Werkbank's taskbar button.
let badgeCount = 0;
async function updateBadge() {
  const n = [...rt.values()].filter((r) => r.attn).length;
  if (n === badgeCount) return;
  badgeCount = n;
  if (!n) return win.setOverlayIcon(undefined).catch(() => {});
  const c = document.createElement('canvas'), x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  c.width = c.height = 32;
  x.fillStyle = '#f59e0b'; // the attention color of the dots
  x.beginPath();
  x.arc(16, 16, 16, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#1a1a1a';
  x.font = `bold ${n > 9 ? 16 : 22}px "Segoe UI", sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(n > 9 ? '9+' : String(n), 16, 17);
  const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  if (n !== badgeCount) return; // the count changed while drawing; that newer call sets the icon
  win.setOverlayIcon(new Uint8Array(await png.arrayBuffer())).catch(console.error);
}
