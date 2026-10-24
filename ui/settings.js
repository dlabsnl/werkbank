// The settings page and what it changes: themes, fonts, sizes, profiles, groups, startup.

// The five most popular coding fonts: Windows ships Cascadia Code and Consolas, the rest are bundled (see build.sh).
const FONTS = ['Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Consolas'];
const CURSORS = [['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']];
const termOptions = () => ({
  fontFamily: `"${L.fontFamily}", Consolas, monospace`, fontSize: L.fontSize,
  cursorStyle: L.cursorStyle, cursorBlink: L.cursorBlink, theme: THEMES[L.theme].term,
});

const uiTheme = () => /** @type {Record<string, { side: string, bg: string, fg: string, mut: string, acc: string, light?: boolean }>} */ (UI_THEMES)[L.uiTheme] ?? UI_THEMES.Graphite;
// Interface size scales the chrome only (CSS zoom via --ui); the terminals keep their own font size.
const ZOOMS = [90, 100, 110, 125, 150];
// Sidebar: always shown, collapsed, or auto-hide (slides in over the terminals at the left edge).
const SIDE_MODES = [['open', 'Always'], ['collapsed', 'Mini'], ['auto', 'Auto-hide']];
// Which terminals start when Werkbank starts.
const STARTUPS = [['shown', 'Terminals in the window'], ['all', 'All terminals']];
// After a setting changed: apply it, save it, and redraw the settings page when it is open (keeping its scroll).
function changed() {
  applySettings();
  save();
  if (pageEl.hidden) return;
  const top = pageEl.scrollTop;
  renderSettings();
  pageEl.scrollTop = top;
}
/** @param {Layout['sideMode']} m */
function setSideMode(m) {
  L.sideMode = m;
  changed();
}

const toggleSide = () => setSideMode((L.sideMode ?? 'open') === 'open' ? 'collapsed' : 'open');
/** @param {number} z */
function setZoom(z) {
  L.uiZoom = ZOOMS.includes(z) ? z : 100;
  changed();
}

// xterm measures the font once, so a bundled font must be loaded before it is applied.
async function applySettings() {
  await Promise.all([400, 700].map((w) => document.fonts.load(`${w} 14px "${L.fontFamily}"`))).catch(() => {});
  const t = THEMES[L.theme], root = document.documentElement, u = uiTheme();
  const vars = { '--side': u.side, '--bg': u.bg, '--fg': u.fg, '--mut': u.mut, '--acc': L.accent || u.acc,
    '--tbg': t.term.background, '--tfg': t.term.foreground, '--ui': (L.uiZoom ?? 100) / 100 };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, String(v));
  root.classList.toggle('light', !!u.light);
  root.classList.toggle('side-collapsed', L.sideMode === 'collapsed');
  root.classList.toggle('side-auto', L.sideMode === 'auto');
  for (const r of rt.values()) {
    Object.assign(r.term.options, termOptions());
    try { if (r.pane.isConnected) r.fit.fit(); } catch {}
  }
}

/** @param {number} size */
function setFont(size) {
  L.fontSize = Math.min(28, Math.max(9, size));
  changed();
}

const pageEl = $('#settings-page');

function renderSettings() {
  const card = (/** @type {[string, (typeof THEMES)[string]]} */ [n, t]) => {
    // compact card (name + colors); the terminal preview pops out on hover without moving the grid
    const c = t.term, ansi = /** @type {const} */ (['foreground', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'])
      .map((k) => `<i style="background:${c[k]}"></i>`).join('');
    return `<button class="card${n === L.theme ? ' on' : ''}" data-theme="${esc(n)}" style="background:${c.background};color:${c.foreground}">
      <div class="cname">${esc(n)}</div><div class="cansi">${ansi}</div>
      <div class="cprev"><span style="color:${c.green}">➜</span> <span style="color:${c.blue}">werkbank</span>
        <span style="color:${c.yellow}">git:(main)</span> ls<br><span style="color:${c.cyan}">src</span>
        <span style="color:${c.magenta}">ui</span> README.md<br><span style="color:${c.red}">error</span>: 1 file changed</div></button>`;
  };
  const row = (/** @type {string} */ label, /** @type {string} */ hint, /** @type {string} */ ctl) => `<div class="srow"><div class="lbl">${label}${hint ? `<small>${hint}</small>` : ''}</div><div class="ctl">${ctl}</div></div>`;
  const k = (/** @type {string[]} */ ...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
  const KEYS = [
    ['Split right / down', `${k('Alt', 'Shift', '=')} / ${k('-')}`],
    ['Go to a terminal by name, topic or group', k('Ctrl', 'Shift', 'P')],
    ['Switch to terminal 1–9', k('Ctrl', '1…9')],
    ['Next pane', k('Ctrl', 'Tab')],
    ['Pane to the left / right / above / below', `${k('Alt')} + arrow keys`],
    ['Maximize the pane / back to the split', k('Ctrl', 'Shift', 'Enter')],
    ['New terminal like this one (same profile and folder)', k('Ctrl', 'Shift', 'D')],
    ['Rename the terminal', k('F2')],
    ['Werkbank to the front from anywhere (again: minimize)', k('Win', 'Ctrl', 'W')],
    ['Terminal font size', `${k('Ctrl', '=')} / ${k('-')} / ${k('0')}`],
    ['Interface size (everything)', `${k('Ctrl', 'Shift', '=')} / ${k('-')} / ${k('0')}`],
    ['Full screen', k('F11')],
    ['Show / hide the sidebar', k('Ctrl', 'Shift', 'B')],
    ['Copy / paste', `${k('Ctrl', 'C')} / ${k('V')}, or right-click: pastes, or copies a selection (a program that reads the mouse, like Claude, handles it itself)`],
    ['Terminal menu (find, split, hide)', `${k('Shift')} + right-click in the terminal`],
    ['Find in a terminal', k('Ctrl', 'Shift', 'F')],
    ['Open a link', `${k('Ctrl')} + click`],
    ['Paste a file path', 'Drop the file from Explorer onto the terminal'],
    ['Profile and folder of a group', 'Settings > Groups, or right-click the group'],
    ['Select terminals (like Explorer)', `${k('Ctrl')} + click toggles, ${k('Shift')} + click selects a range, ${k('Ctrl')}${k('Shift')} + click adds a range, ${k('Ctrl')}${k('A')} all`],
    ['Bring a terminal to the front when it is done', 'Right-click it in the sidebar'],
    ['Close a terminal from inside', `/exit in Claude, exit in a shell (${k('Ctrl', 'Z')} brings it back)`],
    ['Show all terminals at once', 'The grid button at the top of the sidebar'],
    ['Split with an existing terminal', 'Drag it onto a pane edge'],
    ['Move a pane', 'Drag its title onto the edge of another pane, or onto its middle to swap the two'],
    ['Resize panes in steps (25 / 33 / 50 / 67 / 75 %)', `${k('Shift')} while dragging a divider`],
    ['Rename a terminal or group', 'Double-click its name'],
    ['Reorder groups and terminals', 'Drag them up or down in the sidebar'],
    ['Undo the last change (outside a terminal)', k('Ctrl', 'Z')],
    ['With a selection', `the bar shows them side by side or stops them; ${k('Delete')} stops them (${k('Ctrl', 'Z')} undoes), ${k('Esc')} clears`],
  ];
  const uiCard = (/** @type {[string, ReturnType<typeof uiTheme>]} */ [n, u]) => `<button class="card${n === (L.uiTheme ?? 'Graphite') ? ' on' : ''}" data-ui="${esc(n)}"
      style="background:${u.side};color:${u.fg}"><div class="cname">${esc(n)}</div>
      <div class="cansi">${[u.bg, u.fg, u.mut, u.acc].map((c) => `<i style="background:${c}"></i>`).join('')}</div></button>`;
  const field = (/** @type {string} */ l, /** @type {string} */ ctl) => `<label class="pf-field"><span>${l}</span>${ctl}</label>`;
  const browse = `<button class="btn" data-browse title="Choose a folder">${icon('folder')}</button>`;
  const inUse = (/** @type {string} */ name) => allSessions().filter((s) => s.profile === name).length;
  // one line per profile (what it runs, in a code font); click it to edit just that one
  const profileRow = (/** @type {Profile} */ p, /** @type {number} */ i) => {
    const n = inUse(p.name), locked = n || profiles.length < 2, dflt = p === defaultProfile(), open = openProfile === p.name;
    const runs = [p.command?.[0]?.split(/[\\/]/).pop(), joinArgs(p.command?.slice(1) ?? [])].filter(Boolean).join(' ');
    return `<div class="pf${open ? ' open' : ''}" data-i="${i}">
      <button class="pf-row" data-pf-open>${progIcon(p.name, 18)}<b>${esc(p.name)}</b>${dflt ? '<span class="tag">Default</span>' : ''}
        <code>${esc(runs)}${p.cwd ? ` · ${esc(p.cwd)}` : ''}</code>${icon('chevron', 14)}</button>
      ${open ? `<div class="pf-edit">
        ${field('Name', `<input data-pf="name" value="${esc(p.name)}" spellcheck="false">`)}
        ${field('Program', `<input data-pf="program" value="${esc(p.command?.[0] ?? '')}" spellcheck="false">`)}
        ${field('Options', `<input data-pf="options" value="${esc(joinArgs(p.command?.slice(1) ?? []))}" placeholder="none" spellcheck="false">`)}
        ${field('Start folder', `<input data-pf="cwd" value="${esc(p.cwd ?? '')}" placeholder="Werkbank's own folder" spellcheck="false">${browse}`)}
        <div class="pf-acts"><button class="btn${dflt ? ' on' : ''}" data-pf-default${dflt ? ' disabled' : ''} title="${dflt ? 'This is the default profile' : 'Make default: the + buttons and groups without their own profile use it'}">${icon('star')}</button>
          <button class="btn" data-pf-del${locked ? ' disabled' : ''} title="${n ? `Used by ${n} terminal${n > 1 ? 's' : ''}: remove those first` : locked ? 'The last profile stays' : 'Delete this profile'}">${icon('trash')}</button></div>
      </div>` : ''}</div>`;
  };
  const groupRow = (/** @type {Group} */ g) => `<div class="gf" id="group-${g.id}" data-g="${g.id}"><b title="${esc(groupPath(L.groups, g))}">${esc(groupPath(L.groups, g))}</b>
    <select data-gf="profile"><option value="">Default (${esc(defaultProfile().name)})</option>${profiles.map((p) => `<option${p.name === g.profile ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <input data-gf="cwd" value="${esc(g.cwd ?? '')}" placeholder="${esc(groupProfile(g).cwd ?? "Werkbank's own folder")} (the profile's folder)" spellcheck="false">${browse}</div>`;
  pageEl.innerHTML = `<div class="sp-inner">
    <div class="sp-head"><h2>Settings</h2><button class="icon-btn" data-close title="Close (Esc)">${icon('x')}</button></div>
    <h3 id="profiles-section">Profiles</h3>
    <div class="panel">${profiles.map(profileRow).join('')}
      <div class="pf-foot"><button class="btn" data-pf-add title="Add a profile">${icon('plus')}</button>
        <small>Changes apply to new terminals and restarts; Ctrl+Z undoes them. Resume, warm start and icon: <button class="link" data-pf-json>profiles.json</button></small></div></div>
    <h3 id="groups-section">Groups</h3>
    <div class="panel"><p class="hint">The profile and folder new terminals in a group start with. A terminal keeps its folder, so Claude finds its conversation again.</p>
      ${groupTree(L.groups).map(({ g }) => groupRow(g)).join('')}</div>
    <h3>Startup</h3>
    <div class="panel">
      ${row('When Werkbank starts', L.startup === 'all' ? 'Every terminal starts in the background, one after another; Claude continues its conversation'
        : 'The terminals in the window start; the others when you open them',
      `<div class="seg">${STARTUPS.map(([v, l]) => `<button data-startup="${v}" class="${v === (L.startup ?? 'shown') ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
    </div>
    <h3>App theme</h3>
    <div class="cards">${Object.entries(UI_THEMES).map(uiCard).join('')}</div>
    <div class="panel" style="margin-top:12px">
      ${row('Accent color', 'Buttons, focus and highlights',
      `<button class="btn" data-reset-accent${L.accent ? '' : ' disabled'} title="Back to the theme's accent color">${icon('undo')}</button>
       <input type="color" data-k="accent" value="${L.accent || uiTheme().acc}">`)}
      ${row('Sidebar', 'Ctrl+Shift+B or the button next to New group shows / hides it; auto-hide slides it in at the left edge',
      `<div class="seg">${SIDE_MODES.map(([v, l]) => `<button data-side="${v}" class="${v === (L.sideMode ?? 'open') ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
      ${row('Interface size', 'Sidebar, title bar, menus and settings · Ctrl+Shift+= / - / 0',
      `<div class="seg">${ZOOMS.map((z) => `<button data-zoom="${z}" class="${z === (L.uiZoom ?? 100) ? 'on' : ''}">${z}%</button>`).join('')}</div>`)}
    </div>
    <h3>Notifications</h3>
    <div class="panel">
      ${row('Sound', 'When Werkbank is not in front and a terminal rings its bell, or Claude finishes',
        `<button class="btn" data-test-attn title="Try it">${icon('play')}</button><input type="checkbox" class="switch" data-k="notifySound"${L.notifySound ? ' checked' : ''}>`)}
      ${row('Volume', 'Release the slider to hear it',
        `<input type="range" data-k="notifyVolume" min="0" max="100" step="5" value="${L.notifyVolume ?? 50}"><b class="val">${L.notifyVolume ?? 50}</b>`)}
      ${row('Windows notification', 'When you are in another program: names the terminal, and clicking it opens that terminal',
        `<input type="checkbox" class="switch" data-k="notifyToast"${L.notifyToast !== false ? ' checked' : ''}>`)}
      ${row('Flash', 'The terminal blinks in the sidebar, Werkbank flashes in the taskbar and its button counts the terminals waiting for you',
        `<input type="checkbox" class="switch" data-k="notifyFlash"${L.notifyFlash !== false ? ' checked' : ''}>`)}
    </div>
    <h3>Terminal colors</h3>
    ${[['dark', 'Dark'], ['medium', 'Medium'], ['light', 'Light']].map(([tone, title]) => `<h4>${title}</h4>
    <div class="cards">${Object.entries(THEMES).filter(([, t]) => t.tone === tone).map(card).join('')}</div>`).join('')}
    <h3>Terminal font</h3>
    <div class="fonts">${FONTS.map((f) => `<button class="font${f === L.fontFamily ? ' on' : ''}" data-font="${esc(f)}">
      <span class="fsample" style="font-family:'${esc(f)}'">ls -la =&gt; 0O il1 {}</span><span class="fname">${esc(f)}</span></button>`).join('')}</div>
    <div class="panel" style="margin-top:12px">
      ${row('Font size', 'The number shows the size the terminals get', `<input type="range" data-k="fontSize" min="9" max="28" value="${L.fontSize}"><b class="val fsize" style="font-family:'${esc(L.fontFamily)}';--fs:${L.fontSize}px">${L.fontSize}</b>`)}
      ${row('Cursor', '', `<div class="seg">${CURSORS.map(([v, l]) => `<button data-cursor="${v}" class="${v === L.cursorStyle ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
      ${row('Blinking cursor', '', `<input type="checkbox" class="switch" data-k="cursorBlink"${L.cursorBlink ? ' checked' : ''}>`)}
      ${row('Copy on select', 'Selecting text with the mouse copies it. Claude Code has its own (/config > Copy on select); turn that off if you only want this one', `<input type="checkbox" class="switch" data-k="copySelect"${L.copySelect ? ' checked' : ''}>`)}
      ${row('Open file links with', 'Ctrl+click on file:line in a terminal opens it at that line. Empty: VS Code or Notepad++ when installed, else Notepad. {file}, {line} and {col} are filled in',
        `<input data-k="editor" value="${esc(L.editor ?? '')}" placeholder="automatic" spellcheck="false">`)}
    </div>
    <h3 id="keys">Keyboard shortcuts</h3>
    <div class="panel">${KEYS.map(([what, keys]) => row(what, '', keys)).join('')}</div>
    <h3 id="about-section">About</h3>
    <div class="panel">
      <div class="about-head"><span class="logo big">W</span>
        <div><b>Werkbank</b> <span class="mut">${esc(APP.version)}</span>
          <small>Terminal workspace for Windows · MIT License · © 2026 dlabsnl</small></div></div>
      ${row('Log', 'Errors, terminals that stopped, and werkbank commands', '<button class="link" data-open-log>werkbank.log</button>')}
      ${row('WebView2 runtime', 'Microsoft Edge WebView2', esc(APP.webview))}
      ${APP.components.map((c) => row(esc(c.name), esc(c.license), esc(c.version))).join('')}
    </div></div>`;
}

// Version info for Settings > About: the app's own, the WebView2 runtime, and the bundled components.
/** @type {{ version: string, webview: string, components: { name: string, license: string, version: string }[] }} */
const APP = { version: '', webview: navigator.userAgent.match(/Edg\/([\d.]+)/)?.[1] ?? 'unknown', components: [] };
window.__TAURI__.app.getVersion().then((v) => { APP.version = `v${v}`; }).catch(() => {});
fetch('vendor/about.json').then((r) => r.json()).then((c) => { APP.components = c; }).catch(() => {});
/** @param {string} [section] */
async function openSettings(section) {
  await syncProfiles();
  renderSettings();
  pageEl.hidden = false;
  const el = section && pageEl.querySelector(section);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
  else pageEl.scrollTop = 0;
}

// Options of a profile as one line of text, and back; arguments with spaces are quoted.
const joinArgs = (/** @type {string[]} */ a) => a.map((x) => (!x || /\s/.test(x) ? `"${x}"` : x)).join(' ');
const splitArgs = (/** @type {string} */ t) => [...t.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
/** @type {string | null} */
let openProfile = null; // the profile opened for editing in Settings (by name)
// Saves profiles.json; warm sessions started with the old settings are replaced.
async function saveProfiles() {
  await invoke('save_profiles', { profiles }).catch(console.error);
  await profilesChanged();
}
// profiles.json may have been edited by hand or by a program in a terminal: read again when Werkbank gets the focus,
// when Settings opens and before `werkbank open`, so a new profile works without a restart.
async function syncProfiles() {
  const before = JSON.stringify(profiles), disk = (await invoke('load').catch(() => null))?.profiles;
  if (!disk || JSON.stringify(disk) === before || JSON.stringify(profiles) !== before) return;
  profiles = disk;
  log('profiles.json changed on disk:', profiles.map((p) => p.name).join(', '));
  await profilesChanged();
}
addEventListener('focus', () => syncProfiles());
async function profilesChanged() {
  for (const [k, s] of Object.entries(spares)) { drop(s.id); delete spares[k]; }
  setTimeout(() => profiles.forEach(prestart), 1500);
  for (const k of Object.keys(programIcons)) { URL.revokeObjectURL(programIcons[k]); delete programIcons[k]; }
  await loadProgramIcons();
  renderView();
  changed();
}
/**
 * @param {Profile} p
 * @param {string} field
 * @param {string} v
 */
function editProfile(p, field, v) {
  v = v.trim();
  // an empty or taken name, or no program: refused, the field shows the old value again
  if ((field === 'name' && (!v || profiles.some((x) => x !== p && x.name === v))) || (field === 'program' && !v)) return changed();
  checkpoint(`${field === 'default' ? 'default profile' : field === 'cwd' ? 'start folder' : field} of ${p.name}`);
  if (field === 'default') { for (const x of profiles) delete x.default; p.default = true; }
  else if (field === 'name') {
    for (const s of allSessions()) if (s.profile === p.name) s.profile = v;
    for (const g of L.groups) if (g.profile === p.name) g.profile = v;
    if (openProfile === p.name) openProfile = v;
    p.name = v;
  } else if (field === 'program') p.command = [v, ...(p.command?.slice(1) ?? [])];
  else if (field === 'options') p.command = [p.command?.[0] ?? '', ...splitArgs(v)];
  else if (v) p.cwd = v;
  else delete p.cwd;
  saveProfiles();
}
pageEl.addEventListener('change', (e) => {
  const t = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target), { pf, gf } = t.dataset;
  if (t.dataset.k === 'notifyVolume') chime(); // preview the alert at the new volume once the slider is released
  if (pf) editProfile(profiles[Number(/** @type {HTMLElement} */ (t.closest('.pf')).dataset.i)], pf, t.value);
  if (gf) {
    const g = L.groups.find((x) => x.id === /** @type {HTMLElement} */ (t.closest('.gf')).dataset.g);
    if (!g) return; // removed while the page was open
    checkpoint(`${gf === 'cwd' ? 'folder' : 'profile'} of ${g.name}`);
    g[/** @type {'profile' | 'cwd'} */ (gf)] = t.value.trim() || undefined;
    renderView();
    changed();
  }
});
pageEl.addEventListener('click', async (e) => {
  const b = /** @type {Element} */ (e.target).closest('[data-pf-add], [data-pf-del], [data-pf-open], [data-pf-default], [data-browse], [data-pf-json], [data-open-log]');
  if (!(b instanceof HTMLElement)) return;
  if ('openLog' in b.dataset) return invoke('open_log').catch(console.error);
  const p = profiles[Number(/** @type {HTMLElement | null} */ (b.closest('.pf'))?.dataset.i)];
  if ('pfJson' in b.dataset) return invoke('open_profiles').catch(console.error);
  if ('pfOpen' in b.dataset) { openProfile = openProfile === p.name ? null : p.name; return changed(); }
  if ('pfDefault' in b.dataset) return editProfile(p, 'default', '');
  if ('browse' in b.dataset) {
    const inp = /** @type {HTMLInputElement} */ (b.previousElementSibling), dir = await window.__TAURI__.dialog.open({ directory: true }).catch(() => null);
    if (dir) { inp.value = dir; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  if ('pfAdd' in b.dataset) {
    let name = 'New profile', i = 2;
    while (profiles.some((p) => p.name === name)) name = `New profile ${i++}`;
    checkpoint('add profile');
    profiles.push({ name, command: ['cmd.exe'] });
    openProfile = name;
  } else {
    checkpoint(`delete profile ${p.name}`); // Ctrl+Z brings it back
    profiles.splice(profiles.indexOf(p), 1);
    for (const g of L.groups) if (g.profile === p.name) delete g.profile;
  }
  saveProfiles();
});
function closeSettings() { pageEl.hidden = true; if (L.active) rt.get(L.active)?.term.focus(); }
$('#settings').onclick = () => (pageEl.hidden ? openSettings() : closeSettings());
$('#shortcuts').onclick = () => openSettings('#keys');
$('#about').onclick = () => openSettings('#about-section');
pageEl.addEventListener('click', (e) => {
  const b = /** @type {Element} */ (e.target).closest('button');
  if (!b) return;
  if (b.dataset.theme) L.theme = b.dataset.theme;
  else if (b.dataset.ui) { L.uiTheme = b.dataset.ui; L.accent = null; }
  else if (b.dataset.zoom) return setZoom(Number(b.dataset.zoom));
  else if (b.dataset.side) return setSideMode(/** @type {Layout['sideMode']} */ (b.dataset.side));
  else if (b.dataset.startup) L.startup = /** @type {Layout['startup']} */ (b.dataset.startup);
  else if ('testAttn' in b.dataset) return attention(null, true);
  else if (b.dataset.cursor) L.cursorStyle = /** @type {Layout['cursorStyle']} */ (b.dataset.cursor);
  else if (b.dataset.font) L.fontFamily = b.dataset.font;
  else if ('resetAccent' in b.dataset) L.accent = null;
  else if ('close' in b.dataset) return closeSettings();
  else return;
  changed();
});
pageEl.addEventListener('input', (e) => {
  const t = e.target, k = t instanceof HTMLInputElement && t.dataset.k;
  if (!k) return;
  const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
  Object.assign(L, { [k]: v });
  applySettings();
  save();
  if (t.type === 'range') /** @type {HTMLElement} */ (t.nextElementSibling).textContent = String(v);
  if (k === 'fontSize') /** @type {HTMLElement} */ (t.nextElementSibling).style.setProperty('--fs', `${v}px`);
  if (k === 'accent') /** @type {HTMLButtonElement} */ (pageEl.querySelector('[data-reset-accent]')).disabled = false;
});
