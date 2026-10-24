// Startup: loads profiles and layout, then shows the window. Loaded last. Also saves screens and the layout on quit.

// Screens of non-resumable sessions are kept on disk so they come back after a restart.
const saveScreens = () => [...rt].flatMap(([id, r]) => {
  const f = findSession(id);
  if (!f || !r.opened || profileOf(f.s)?.resume) return [];
  return [invoke('save_screen', { id, data: r.ser.serialize({ scrollback: 2000 }) }).catch((e) => log('could not save a screen:', e))];
});
setInterval(saveScreens, 60000);
listen('before-quit', async () => {
  clearTimeout(saveTimer);
  await Promise.allSettled([invoke('save_layout', { layout: L }), ...saveScreens(), log('closed')]);
  invoke('quit');
});

(async () => {
  try {
    const st = await invoke('load');
    profiles = st.profiles;
    if (st.layout) L = st.layout;
  } catch (e) {
    $('#empty h2').textContent = 'Could not load settings';
    $('#empty p').textContent = String(e);
    log('could not load settings:', e);
    return;
  }
  if (!Array.isArray(L.groups)) L.groups = [];
  L.tree ??= null;
  // colors end up in style attributes: only #rrggbb from layout.json
  for (const o of [...L.groups, ...L.groups.flatMap((g) => g.sessions ?? [])]) if (o.color && !/^#[0-9a-f]{6}$/i.test(o.color)) delete o.color;
  for (const g of L.groups) if (typeof g.parent !== 'string') delete g.parent;
  L.fontSize ??= 14;
  if (!FONTS.includes(L.fontFamily)) L.fontFamily = 'Cascadia Code';
  L.cursorStyle ??= 'block';
  L.cursorBlink ??= true;
  if (!(L.uiTheme in UI_THEMES)) L.uiTheme = 'Graphite';
  if (!THEMES[L.theme]) L.theme = 'GitHub Dark';
  if (L.uiZoom === undefined || !ZOOMS.includes(L.uiZoom)) L.uiZoom = 100;
  setSideWidth(L.sideWidth ?? SIDE.default);
  await Promise.all([applySettings(), loadProgramIcons()]);
  if (!L.groups.length) L.groups.push({ id: uid(), name: 'General', collapsed: false, sessions: [] });
  renderView();
  invoke('launch_target').then((id) => { if (id && findSession(id)) reveal(id); }).catch((e) => log('launch target:', e));
  // "All terminals" at startup: the rest start in the background too, one every 400 ms so they don't all load at once
  if (L.startup === 'all') allSessions().forEach((s, i) => setTimeout(() => start(s), 800 + i * 400));
  setTimeout(() => profiles.forEach(prestart), 1500); // after the visible panes had their start
  invoke('prune_screens', { keep: allSessions().map((s) => s.id) }).catch((e) => log('could not prune screens:', e));
  updateUndo();
  log(`started ${APP.version}, ${allSessions().length} terminals in ${L.groups.length} groups`);
  // `werkbank --selftest` (main.rs): the checks in selftest.js, which is only loaded then
  if (await invoke('selftest_exe')) document.body.append(Object.assign(document.createElement('script'), { src: 'selftest.js' }));
})();
