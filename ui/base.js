// Shared state (L, profiles, rt), small helpers, icons, saving and undo. Loaded first; every other file uses it.

const { Channel } = window.__TAURI__.core;
/**
 * Calls a Rust command; its arguments and result are checked against `Commands` (types.d.ts).
 * @template {keyof Commands} K
 * @param {K} cmd
 * @param {Commands[K][0] extends undefined ? [] : [Commands[K][0]]} args
 * @returns {Promise<Commands[K][1]>}
 */
const invoke = (cmd, ...args) => window.__TAURI__.core.invoke(cmd, args[0]);
/**
 * Listens to an event from Rust; its payload is checked against `Events` (types.d.ts).
 * @template {keyof Events} K
 * @param {K} event
 * @param {(e: { payload: Events[K] }) => void} fn
 */
const listen = (event, fn) => window.__TAURI__.event.listen(event, fn);

// xterm draws block characters (the Claude Code logo) as rectangles in eighths of a cell; with an odd cell width the
// half-block edges land between pixels and blur into dark seams. Snap rectangles to whole pixels, like Windows Terminal.
// shortcut: patches fillRect for every 2D canvas in the page; xterm is the only user that draws fractional rects.
{
  const fill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
    const x0 = Math.round(x), y0 = Math.round(y);
    fill.call(this, x0, y0, Math.round(x + w) - x0, Math.round(y + h) - y0);
  };
}

/** @type {Profile[]} */
let profiles = [];
// Persisted layout: groups with their sessions, the split tree shown in the window, and the focused session.
// Tree node: { id } (a pane) or { dir: 'row' | 'col', ratio, a, b } (row = side by side, col = stacked).
/** @type {Layout} */
let L = { groups: [], tree: null, active: null, theme: 'GitHub Dark', uiTheme: 'Graphite', accent: null, fontSize: 14, fontFamily: 'Cascadia Code', cursorStyle: 'block', cursorBlink: true };
/** @type {Map<string, Runtime>} session id -> its xterm, pane and program state */
const rt = new Map();
/** @type {boolean} a name is being edited in the sidebar: it does not redraw meanwhile */
let editing = false;
/** @type {string | null} the trash button a first click armed: a terminal id, 'sel' or 'g:<group id>' */
let armed = null;

// shortcut: typed as always found; it is only used with selectors of the page's own fixed elements
const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const groupsEl = $('#groups'), viewEl = $('#view'), menuEl = $('#menu');
/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (/** @type {string} */ t) => t.replace(/[&<>"]/g, (c) => ENTITIES[c]);
const uid = () => crypto.randomUUID();
// A line in werkbank.log (logs\ next to layout.json), to find out afterwards what went wrong. Errors land there too.
const log = (/** @type {unknown[]} */ ...parts) => invoke('log', { line: parts.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ') }).catch(() => {});
{
  const error = console.error;
  console.error = (...a) => { error(...a); log('error:', ...a); };
}
addEventListener('error', (e) => log('error:', e.error ?? e.message));
addEventListener('unhandledrejection', (e) => log('error:', e.reason));

// Line icons (16px grid; `vb: 24` marks icons drawn on a 24px grid).
/** @type {Record<string, string | { vb: number, d: string }>} */
const ICONS = {
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  paste: '<rect x="3" y="3.5" width="10" height="10.5" rx="1.5"/><path d="M6 3.5V2.5h4v1M5.5 7.5h5M5.5 10h3.5"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25 13.5 13.5"/>',
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>',
  star: '<path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8L2.5 6.6l3.8-.6z"/>',
  play: '<path d="M5.5 3.5v9l7-4.5z"/>',
  bell: '<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.5H3z"/><path d="M6.5 14a1.5 1.5 0 0 0 3 0"/>',
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  splitRight: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M8 2.5v11"/>',
  splitDown: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 8h12"/>',
  folderPlus: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/><path d="M8 7v4M6 9h4"/>',
  keyboard: '<rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6"/>',
  terminal: '<path d="M3 4.5l3.5 3.5L3 11.5M8 11.5h5"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
  undo: '<path d="M4 6.5h6a3 3 0 0 1 0 6H7"/><path d="M6.5 4 4 6.5 6.5 9"/>',
  sidebar: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>',
  info: '<circle cx="8" cy="8" r="5.75"/><path d="M8 7.5v3.25M8 5.25h.01"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8"/>',
  min: '<path d="M3.5 8h9"/>',
  max: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
  restore: '<rect x="3.5" y="5.5" width="7" height="7" rx="1.2"/><path d="M6 5.5v-1a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-1"/>',
  fullscreen: '<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>',
  exitFullscreen: '<path d="M6 2.5V5a1 1 0 0 1-1 1H2.5M13.5 6H11a1 1 0 0 1-1-1V2.5M10 13.5V11a1 1 0 0 1 1-1h2.5M2.5 10H5a1 1 0 0 1 1 1v2.5"/>',
  gear: {
    vb: 24,
    d: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  },
};
/** @param {string} name @param {number} [size] */
function icon(name, size = 16) {
  const i = ICONS[name], { vb, d } = typeof i === 'string' ? { vb: 16, d: i } : i;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${vb === 24 ? 1.8 : 1.4}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}
// Icons of the profiles' programs (from their .exe), as blob URLs by profile name; terminal icon as fallback.
/** @type {Record<string, string>} */
const programIcons = {};
async function loadProgramIcons() {
  await Promise.all(profiles.map(async (p) => {
    const file = p.icon ?? '';
    if (/\.(png|ico|svg|jpe?g)$/i.test(file)) {
      const bytes = await invoke('icon_file', { path: file }).catch(() => null);
      if (programIcons[p.name] && bytes) URL.revokeObjectURL(programIcons[p.name]); // two reloads can overlap
      if (bytes) programIcons[p.name] = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: file.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '' }));
      return;
    }
    const r = await invoke('program_icon', { program: p.icon || p.command?.[0] || '' }).catch(() => null);
    if (!r) return;
    const [w, h, px] = r, c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
    const png = /** @type {Blob | null} */ (await new Promise((done) => c.toBlob(done))); // toBlob gives Blob | null
    if (png && programIcons[p.name]) URL.revokeObjectURL(programIcons[p.name]); // two reloads can overlap
    if (png) programIcons[p.name] = URL.createObjectURL(png);
  }));
}
// Color choices for groups and terminals; also the badges of programs without an icon.
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899'];
// Programs without an icon of their own (many CLIs) get a badge with their first letter in a fixed color.
/** @param {string} name @param {number} size */
function badge(name, size) {
  const c = COLORS[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % COLORS.length];
  return `<svg class="picon" width="${size}" height="${size}" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${c}"/>
    <text x="8" y="11.6" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="Segoe UI, sans-serif">${esc((name.trim()[0] ?? '?').toUpperCase())}</text></svg>`;
}
const progIcon = (/** @type {string} */ name, /** @type {number} */ size) => (programIcons[name]
  ? `<img class="picon" src="${programIcons[name]}" width="${size}" height="${size}" alt="">` : badge(name, size));

for (const el of document.querySelectorAll('[data-icon]')) {
  if (el instanceof HTMLElement) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon ?? '', Number(el.dataset.iconSize ?? 16)));
}

/** @type {number | undefined} */
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_layout', { layout: L }).catch(console.error), 300);
}

// Undo: a snapshot before each change (max 30). Undoing a removal brings the terminal back (Claude resumes its
// conversation, shells get their saved screen); undoing an open stops it again; profile edits in Settings come back too.
// Undoable: exactly the fields of Snapshot (groups with their terminals, split tree, active terminal, remembered pane
// spots, profiles). Not undoable on purpose: settings (theme, fonts, sizes, notifications, sidebar), the maximized pane,
// the selection and the sidebar width. A new field in Layout belongs in one of these two lists.
// (not `history`: that name is the browser's own window.history)
/** @typedef {{ groups: Group[], tree: TreeNode | null, active: string | null, spots?: Layout['spots'], profiles?: Profile[] }} Snapshot */
/** @type {{ label: string, snap: string }[]} */
const undoStack = [];
/** @param {string} label what the next Ctrl+Z undoes */
function checkpoint(label) {
  /** @type {Snapshot} */
  const snap = { groups: L.groups, tree: L.tree, active: L.active, spots: L.spots ?? {}, profiles };
  undoStack.push({ label, snap: JSON.stringify(snap) });
  if (undoStack.length > 30) undoStack.shift();
  updateUndo();
}
function undo() {
  const h = undoStack.pop();
  if (!h) return;
  /** @type {Snapshot} */
  const s = JSON.parse(h.snap), keep = new Set(s.groups.flatMap((g) => g.sessions.map((x) => x.id)));
  const spareIds = new Set(Object.values(spares).map((x) => x.id));
  for (const id of [...rt.keys()]) if (!keep.has(id) && !spareIds.has(id)) drop(id);
  const edited = JSON.stringify(s.profiles) !== JSON.stringify(profiles);
  profiles = s.profiles ?? profiles;
  delete s.profiles;
  // groups and terminals still here take their old state in place: code that holds one (a terminal's own session,
  // an open menu) keeps pointing at the live object
  const sessions = allSessions();
  /** @template {object} T @param {T | undefined} old @param {T} x @returns {T} */
  const revive = (old, x) => {
    if (!old) return x;
    for (const k of Object.keys(old)) delete /** @type {Record<string, unknown>} */ (old)[k];
    return Object.assign(old, x);
  };
  s.groups = s.groups.map((g) => revive(L.groups.find((o) => o.id === g.id),
    { ...g, sessions: g.sessions.map((x) => revive(sessions.find((o) => o.id === x.id), x)) }));
  Object.assign(L, s);
  updateUndo();
  if (edited) return saveProfiles();
  renderView();
  if (!pageEl.hidden) changed();
}
function updateUndo() {
  const b = /** @type {HTMLButtonElement} */ ($('#undo')), last = undoStack.at(-1);
  b.disabled = !last;
  b.title = last ? `Undo: ${last.label} (Ctrl+Z)` : 'Nothing to undo';
}

const allSessions = () => groupTree(L.groups).flatMap(({ g }) => g.sessions); // in sidebar order
/** @param {string} id @returns {{ g: Group, s: Session } | undefined} */
function findSession(id) {
  for (const g of L.groups) {
    const s = g.sessions.find((s) => s.id === id);
    if (s) return { g, s };
  }
}
// A terminal's own color wins over its group's.
const colorOf = (/** @type {string} */ id) => { const f = findSession(id); return f && (f.s.color || f.g.color); };

const defaultProfile = () => profiles.find((p) => p.default) || profiles[0];
// What a terminal is called: its own title (like a Windows Terminal tab), unless you renamed it yourself. The first
// title a program sets is generic (Claude Code: "Claude Code") and would make all terminals look alike, so it is skipped.
const label = (/** @type {Session} */ s) => { const r = rt.get(s.id); return (!s.custom && r?.title && r.title !== r.firstTitle && r.title) || s.name; };
const isClaude = (/** @type {Profile | undefined} */ p) => /claude(\.exe)?$/i.test(p?.command?.[0] ?? '');
const profileOf = (/** @type {Session} */ s) => profiles.find((p) => p.name === s.profile) || defaultProfile();
// A group can have its own profile and folder for new terminals (right click on the group row).
const groupProfile = (/** @type {Group | undefined} */ g) => profiles.find((p) => p.name === g?.profile) || defaultProfile();

document.addEventListener('contextmenu', (e) => e.preventDefault()); // no browser menu in the app

// split tree helpers (leaves, without, splitAt, grid, spotOf) live in tree.js
const visible = () => leaves(L.tree);
const widerDir = (/** @type {string} */ id) => { const p = rt.get(id)?.pane; return p && p.offsetHeight > p.offsetWidth ? 'col' : 'row'; };

const pause = (/** @type {number} */ ms) => new Promise((ok) => setTimeout(ok, ms));
