// `werkbank --selftest` (see main.rs): checks every part of the UI against the real exe, in a throwaway folder with two
// cmd profiles. Loaded by main.js only in that mode. Each check is one line in the report; the exit code says if all passed.

(async () => {
  /** @type {string[]} */
  const report = [];
  /** @template T @param {T | null | undefined} x @param {string} what @returns {T} */
  const must = (x, what) => { if (x === null || x === undefined) throw new Error(`missing: ${what}`); return x; };
  /** @param {ParentNode} root @param {string} sel @returns {HTMLElement} */
  const q = (root, sel) => { const e = root.querySelector(sel); if (!(e instanceof HTMLElement)) throw new Error(`missing: ${sel}`); return e; };
  const R = (/** @type {string} */ id) => must(rt.get(id), `terminal ${id}`);
  const ok = (/** @type {string} */ name, /** @type {unknown} */ cond) => report.push(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  const text = (/** @type {string} */ id) => {
    const b = rt.get(id)?.term.buffer.active;
    const lines = [];
    for (let i = 0; b && i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  };
  const printed = (/** @type {string} */ id, /** @type {string} */ s) => new RegExp(`^${s}\\s*$`, 'm').test(text(id)); // a line of output, not the typed command
  const key = (/** @type {string} */ k, /** @type {KeyboardEventInit} */ o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: o.code ?? k, bubbles: true, ...o }));
  const group = () => L.groups[0];
  /** @type {string[]} */
  const blocked = [];
  document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.violatedDirective} ${e.blockedURI}`));
  const exe = await invoke('selftest_exe');
  L.notifyToast = false;
  try {
    // startup (main.js, base.js, window.js)
    ok('startup: profiles and a group', profiles.length === 2 && L.groups.length === 1);
    ok('icons drawn into the buttons', !!$('#settings svg') && !!$('[data-win="max"] svg'));

    // terminals and panes (terminal.js, panes.js)
    const a = newSession(group(), profiles[0], null, 'One');
    const b = newSession(group(), profiles[0], { target: a.id, dir: 'row' }, 'Two');
    await wait(2500);
    ok('both terminals run', rt.get(a.id)?.running && rt.get(b.id)?.running);
    ok('split: two panes', visible().length === 2 && viewEl.querySelectorAll('.pane').length === 2);
    toggleZoom();
    ok('maximize: one pane, layout kept', viewEl.querySelectorAll('.pane').length === 1 && visible().length === 2);
    toggleZoom();
    setActive(a.id);
    ok('Alt+Right: to the right pane', focusDir('ArrowRight') && L.active === b.id);
    hide(b.id);
    ok('hide', visible().length === 1);
    show(b.id, false);
    ok('show: back next to its neighbour', visible().length === 2);
    openFind(R(a.id));
    ok('find box opens', !q(R(a.id).pane, '.find').hidden);
    renderView();
    await wait(100);
    ok('the find box keeps the keyboard when the view redraws', document.activeElement === q(R(a.id).pane, '.find input'));
    closeFind(R(a.id));
    // a rebuild takes the panes out of the page; a wheel turn down afterwards must not jump to the top (#1041)
    const ra = R(a.id), vp = q(ra.pane, '.xterm-viewport');
    ra.term.write('x\r\n'.repeat(300));
    await wait(300);
    renderView();
    await wait(200);
    const bottom = ra.term.buffer.active.viewportY;
    vp.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    await wait(200);
    ok(`after a redraw the wheel down stays at the bottom (line ${ra.term.buffer.active.viewportY} of ${bottom})`, bottom > 0 && ra.term.buffer.active.viewportY === bottom);

    // menus (menus.js)
    openMenu({ x: 30, y: 30 }, () => {});
    ok('profile menu', !menuEl.hidden && menuEl.querySelectorAll('[data-i]').length === 2);
    const termEl = q(R(a.id).pane, '.term');
    termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: 40, clientY: 40 }));
    ok('Shift + right-click: terminal menu', !menuEl.hidden && !!menuEl.querySelector('[data-a="paste"]'));
    menuEl.hidden = true;
    // a clipboard another program holds fails these two checks, not the whole selftest
    const clipFree = await withClipboard(() => clipboard.writeText('echo pasted-by-right-click')).then(() => true, () => false);
    termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await wait(300);
    invoke('write', { id: a.id, data: '\r' });
    await wait(2000);
    ok(`right-click pastes${clipFree ? '' : ' (the clipboard is held by another program)'}`, clipFree && menuEl.hidden && printed(a.id, 'pasted-by-right-click'));
    const rta = R(a.id), realPaste = rta.term.paste;
    let pastes = 0;
    rta.term.paste = () => pastes++;
    rta.term.write('\x1b[?1000h'); // the program turns on mouse reporting, as Claude Code does
    await wait(200);
    termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await wait(300);
    rta.term.write('\x1b[?1000l');
    rta.term.paste = realPaste;
    ok('right-click in a program that reads the mouse: left to it (no double paste)', pastes === 0);
    menuEl.hidden = true;

    // sidebar and undo (sidebar.js, base.js)
    ok('sidebar: two rows', groupsEl.querySelectorAll('.sess').length === 2);
    const trash = () => q(groupsEl, `[data-s="${b.id}"] [data-act="close"]`);
    trash().click();
    ok('trash: first click arms', armed === b.id && !!findSession(b.id));
    trash().click();
    ok('trash: second click removes', !findSession(b.id));
    key('z', { code: 'KeyZ', ctrlKey: true });
    ok('Ctrl+Z brings it back', !!findSession(b.id));
    show(b.id, true);
    await wait(2500);
    // the old program's exit arrives after the new one started under the same id; the new one must keep running
    ok('restored terminal runs', !!rt.get(b.id)?.running);
    API.send({ name: 'Two', text: 'echo restored-ok color-%NO_COLOR%' });
    await wait(3000);
    ok('restored terminal takes input', printed(b.id, 'restored-ok color-.*'));
    // started from a Claude session (as the selftest is), its NO_COLOR=1 must not reach the terminals: cmd leaves it unexpanded
    ok('NO_COLOR from a Claude session is not passed on', printed(b.id, 'restored-ok color-%NO_COLOR%'));
    // Claude Code's "send now" is the chord Ctrl+X Ctrl+S: the keys and the one after them reach a program reading like Claude
    API.send({ name: 'Two', text: 'powershell -NoProfile -EncodedCommand QQBkAGQALQBUAHkAcABlACAALQBOAGEAbQBlACAASwAgAC0ATgBhAG0AZQBzAHAAYQBjAGUAIABXACAALQBNAGUAbQBiAGUAcgBEAGUAZgBpAG4AaQB0AGkAbwBuACAAJwBbAEQAbABsAEkAbQBwAG8AcgB0ACgAIgBrAGUAcgBuAGUAbAAzADIALgBkAGwAbAAiACkAXQAgAHAAdQBiAGwAaQBjACAAcwB0AGEAdABpAGMAIABlAHgAdABlAHIAbgAgAEkAbgB0AFAAdAByACAARwBlAHQAUwB0AGQASABhAG4AZABsAGUAKABpAG4AdAAgAG4AKQA7ACAAWwBEAGwAbABJAG0AcABvAHIAdAAoACIAawBlAHIAbgBlAGwAMwAyAC4AZABsAGwAIgApAF0AIABwAHUAYgBsAGkAYwAgAHMAdABhAHQAaQBjACAAZQB4AHQAZQByAG4AIABiAG8AbwBsACAAUwBlAHQAQwBvAG4AcwBvAGwAZQBNAG8AZABlACgASQBuAHQAUAB0AHIAIABoACwAIABpAG4AdAAgAG0AKQA7ACcAOwBbAFcALgBLAF0AOgA6AFMAZQB0AEMAbwBuAHMAbwBsAGUATQBvAGQAZQAoAFsAVwAuAEsAXQA6ADoARwBlAHQAUwB0AGQASABhAG4AZABsAGUAKAAtADEAMAApACwAIAAwAHgAMgAwADgAKQAgAHwAIABPAHUAdAAtAE4AdQBsAGwAOwAkAHMAIAA9ACAAWwBDAG8AbgBzAG8AbABlAF0AOgA6AE8AcABlAG4AUwB0AGEAbgBkAGEAcgBkAEkAbgBwAHUAdAAoACkAOwAgACcAawBlAHkAcwAtAHIAZQBhAGQAeQAnADsAIAAkAGIAIAA9ACAATgBlAHcALQBPAGIAagBlAGMAdAAgAGIAeQB0AGUAWwBdACAAMQA2ADsAIAAkAHIAIAA9ACAAQAAoACkAOwB3AGgAaQBsAGUAIAAoACQAcgAuAEMAbwB1AG4AdAAgAC0AbAB0ACAAMwApACAAewAgACQAbgAgAD0AIAAkAHMALgBSAGUAYQBkACgAJABiACwAIAAwACwAIAAxADYAKQA7ACAAJAByACAAKwA9ACAAJABiAFsAMAAuAC4AKAAkAG4AIAAtACAAMQApAF0AIAB9ADsAJwBrAGUAeQBzAC0AJwAgACsAIAAoACQAcgAgAC0AagBvAGkAbgAgACcALQAnACkA' }); // raw window + VT input, as libuv sets it
    // wait until it reads its input (compiling the Add-Type takes a varying few seconds)
    for (let i = 0; i < 40 && !printed(b.id, 'keys-ready'); i++) await wait(500);
    const ta = must(R(b.id).term.textarea, 'textarea');
    // q: in processed mode the console takes Ctrl+S as pause and eats the next key; Claude reads raw, so all three arrive
    for (const c of ['x', 's', 'q']) ta.dispatchEvent(new KeyboardEvent('keydown', { key: c, code: `Key${c.toUpperCase()}`, keyCode: c.toUpperCase().charCodeAt(0), ctrlKey: c !== 'q', bubbles: true, cancelable: true }));
    await wait(1500);
    const keysGot = text(b.id).match(/^keys-(?!ready).*$/m)?.[0] ?? 'nothing';
    ok(`Ctrl+X Ctrl+S reach the program${printed(b.id, 'keys-24-19-113') ? '' : ` (got ${keysGot})`}`, printed(b.id, 'keys-24-19-113'));
    // dragging a pane by its title (sidebar.js): middle swaps, an edge moves it there
    const dragTo = (/** @type {string} */ id, /** @type {string} */ to, /** @type {number} */ fx, /** @type {number} */ fy) => {
      const t = q(R(id).pane, '.pbar span'), tr = t.getBoundingClientRect(), r = R(to).pane.getBoundingClientRect();
      const at = { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true };
      t.dispatchEvent(new MouseEvent('mousedown', { clientX: tr.left + 5, clientY: tr.top + 5, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', at));
      window.dispatchEvent(new MouseEvent('mouseup', at));
    };
    const order = leaves(L.tree);
    const dir = () => { const t = must(L.tree, 'layout tree'); return 'dir' in t ? t.dir : undefined; };
    dragTo(a.id, b.id, 0.5, 0.5);
    ok('drag a pane title onto the middle: swapped', leaves(L.tree).join() === [...order].reverse().join() && dir() === 'row');
    dragTo(a.id, b.id, 0.5, 0.97);
    ok('drag a pane title onto the bottom edge: below it', leaves(L.tree).join() === [b.id, a.id].join() && dir() === 'col');
    key('z', { code: 'KeyZ', ctrlKey: true });
    ok('Ctrl+Z undoes the move', dir() === 'row');
    L.copySelect = true;
    R(a.id).term.select(0, 0, 3);
    R(a.id).pane.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wait(300);
    ok('copy on select', (await withClipboard(() => clipboard.readText()).catch(() => null)) === R(a.id).term.getSelection());
    L.copySelect = false;
    selectRange(a.id, b.id, false);
    ok('Shift range select', selected.size === 2);
    clearSelection();

    // attention.js
    attention(b.id, true);
    await wait(300);
    ok('attention: row blinks, taskbar count', !!groupsEl.querySelector(`[data-s="${b.id}"].attn`) && badgeCount === 1);
    setActive(b.id);
    renderSide();

    ok('attention: a note names the terminal', !$('#note').hidden && $('#note').textContent.includes('Two'));
    setActive(a.id);
    $('#note').click();
    ok('clicking the note shows that terminal', L.active === b.id && $('#note').hidden);
    // Claude's title animates while it works (◐/◑, older versions braille) and turns to ✳ when it is done
    setActive(a.id);
    R(b.id).term.write('\x1b]0;◐ Busy\x07');
    await wait(200);
    ok('Claude working: its row shows the turning ring', !!groupsEl.querySelector(`[data-s="${b.id}"].busy`));
    R(b.id).term.write('\x1b]0;✳ Busy\x07');
    await wait(300);
    ok('Claude done (title ◐ to ✳): attention', !!R(b.id).attn && !!groupsEl.querySelector(`[data-s="${b.id}"].attn`));
    // newer versions also report progress (OSC 9;4, as ConEmu and Windows Terminal read it)
    setActive(b.id);
    setActive(a.id);
    R(b.id).term.write('\x1b]9;4;3;\x07');
    await wait(200);
    ok('Claude busy by its progress report: no attention yet', !R(b.id).attn);
    R(b.id).term.write('\x1b]9;4;0;\x07');
    await wait(300);
    ok('Claude done (progress cleared): attention', !!R(b.id).attn);
    R(b.id).term.write('\x1b]9;4;3;\x07');
    await wait(100);
    ok('Claude busy again by itself: attention taken back', !R(b.id).attn && !groupsEl.querySelector(`[data-s="${b.id}"].attn`));
    R(b.id).term.write('\x1b]9;4;0;\x07');
    await wait(100);
    setActive(b.id); // looked at: no longer attention, but still recognizably done
    renderSide();
    ok('Claude done and seen: a check, not the running dot', !!groupsEl.querySelector(`[data-s="${b.id}"].done .dot svg`));
    ok('a shell never gets the ring or the check (it reports no work)', !!groupsEl.querySelector(`[data-s="${a.id}"]:not(.busy):not(.done)`));
    setActive(a.id);
    const old = must(findSession(b.id), 'b').s, oldGroup = must(findSession(b.id), 'b').g;
    checkpoint('selftest');
    old.name = 'Renamed';
    undo();
    ok('undo restores in place: terminals and groups keep their objects', must(findSession(b.id), 'b').s === old && must(findSession(b.id), 'b').g === oldGroup && old.name !== 'Renamed');
    removeSession('gone'); // already removed: no error
    setActive(b.id);

    // group color: a glow over the whole group block; a terminal row only shows its own color (sidebar.js, style.css)
    group().color = '#3b82f6';
    renderSide();
    ok('group color: glow over the whole group, not a bar per row',
      getComputedStyle(q(groupsEl, `[data-g="${group().id}"]`)).backgroundImage.includes('gradient') && !q(groupsEl, `[data-s="${b.id}"]`).style.getPropertyValue('--sc'));
    /** @type {Group} */
    const csub = { id: uid(), name: 'Colored sub', collapsed: false, sessions: [], parent: group().id };
    L.groups.push(csub);
    renderSide();
    const subEl = q(groupsEl, `[data-g="${csub.id}"]`);
    ok('group color: a subgroup continues it, also in its indent', getComputedStyle(subEl).marginLeft === '0px' && subEl.style.getPropertyValue('--tc') === '#3b82f6');
    csub.color = '#ef4444';
    renderSide();
    ok('group color: a subgroup with its own color keeps the top color in its indent', q(groupsEl, `[data-g="${csub.id}"]`).classList.contains('own'));
    L.groups = L.groups.filter((x) => x !== csub);
    group().color = undefined;
    renderSide();

    // bring to front when done (attention.js, menus.js)
    q(groupsEl, `[data-s="${b.id}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    q(menuEl, '[data-front]').click();
    ok('right-click: bring to front when done', must(findSession(b.id), 'b').s.front === true && !!groupsEl.querySelector(`[data-s="${b.id}"] .sfront`));
    hide(b.id);
    attention(b.id);
    ok('done: it comes to the front', visible().includes(b.id) && L.active === b.id);
    must(findSession(b.id), 'b').s.front = undefined;

    // group menu (menus.js, sidebar.js): what the row buttons do, and deleting a group with what is in it
    /** @type {Group} */
    const dg = { id: uid(), name: 'To delete', collapsed: false, sessions: [] };
    L.groups.push(dg, { id: uid(), name: 'Sub', collapsed: false, sessions: [], parent: dg.id });
    const dt = newSession(dg, profiles[0], { target: a.id, dir: 'row' }, 'Del');
    await wait(1500);
    q(groupsEl, `[data-g="${dg.id}"] .ghead`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    ok('group menu: new terminal, rename, lock, profile, close all, delete', !menuEl.hidden
      && ['add', 'pick', 'subgroup', 'tile', 'rename', 'lock', 'gs', 'closeall', 'delgroup'].every((x) => !!menuEl.querySelector(`[data-a="${x}"]`)));
    q(menuEl, '[data-a="delgroup"]').click();
    ok('group menu: delete with a running terminal first arms', !menuEl.hidden && armed === `d:${dg.id}` && L.groups.includes(dg));
    q(menuEl, '[data-a="lock"]').click();
    ok('group menu: another row while delete is armed just acts and closes the menu', menuEl.hidden && dg.locked === true);
    dg.locked = false;
    q(groupsEl, `[data-g="${dg.id}"] .ghead`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    q(menuEl, '[data-a="delgroup"]').click();
    q(menuEl, '[data-a="delgroup"]').click();
    ok('group menu: the second click deletes the group, its subgroup and its terminal', menuEl.hidden
      && !L.groups.some((x) => x.id === dg.id || x.parent === dg.id) && !findSession(dt.id) && !rt.has(dt.id) && visible().length === 2);
    undo();
    await wait(300);
    const dg2 = L.groups.find((x) => x.id === dg.id);
    ok('group menu: Ctrl+Z brings the group back with what was in it', !!dg2 && L.groups.some((x) => x.parent === dg.id) && !!findSession(dt.id));
    if (dg2) {
      const ev = new MouseEvent('click');
      groupAct(dg2, 'delgroup', ev);
      if (armed === `d:${dg.id}`) groupAct(dg2, 'delgroup', ev);
    }
    await wait(100);

    // settings.js
    await openSettings();
    renderView(); // also runs while Settings is open (profile edits, undo, window focus)
    await wait(100); // the keyboard is handed back in the next frame (settleView)
    ok('settings keep the keyboard when the view redraws', !document.activeElement?.closest('.xterm'));
    const sp = pageEl.getBoundingClientRect(), area = viewEl.getBoundingClientRect();
    ok('settings is a panel at the right: the terminals stay in view', sp.right >= area.right - 1 && sp.width < area.width - 100 && visible().length === 2);
    ok('settings: profiles and groups', !pageEl.hidden && pageEl.querySelectorAll('.pf').length === 2 && pageEl.querySelectorAll('.gf').length === 1);
    q(pageEl, '[data-zoom="110"]').click();
    await wait(300); // applySettings waits for the font first
    ok('interface size applies', L.uiZoom === 110 && document.documentElement.style.getPropertyValue('--ui') === '1.1');
    const fs = /** @type {HTMLInputElement} */ (q(pageEl, '[data-k="fontSize"]')), was = L.fontSize;
    fs.value = '20';
    fs.dispatchEvent(new Event('input', { bubbles: true }));
    const shown = q(pageEl, '.fsize').getBoundingClientRect().height;
    ok('font size number is shown at the terminal size, also when zoomed', L.fontSize === 20 && Math.abs(shown - 20) < 1.5);
    setFont(was);
    q(pageEl, '[data-zoom="100"]').click();
    ok('options split and joined', JSON.stringify(splitArgs('--a "b c"  d')) === '["--a","b c","d"]' && joinArgs(['--a', 'b c']) === '--a "b c"');
    editProfile(profiles[1], 'options', '/k echo hi');
    await wait(500);
    const disk = (await invoke('load')).profiles;
    ok('profile options saved to profiles.json', JSON.stringify(disk[1].command) === '["cmd.exe","/k","echo","hi"]');
    key('z', { code: 'KeyZ', ctrlKey: true });
    await wait(500);
    ok('Ctrl+Z undoes the profile edit', JSON.stringify(profiles[1].command) === '["cmd.exe"]');
    pageEl.hidden = false;
    q(groupsEl, '[data-act="tile"]').click();
    ok('show whole group leaves settings', pageEl.hidden && visible().length === 2);
    const spotsBefore = JSON.stringify(L.spots ?? {}), hid = visible()[1];
    hide(hid);
    const remembered = !!L.spots?.[hid];
    key('z', { code: 'KeyZ', ctrlKey: true });
    ok('hiding remembers the spot, Ctrl+Z takes it back with the pane', remembered && visible().includes(hid) && JSON.stringify(L.spots ?? {}) === spotsBefore);
    await wait(100);
    ok('after a redraw the keyboard is in the active terminal', !!document.activeElement?.closest('.xterm'));
    await openSettings();
    key('Escape');
    ok('Esc closes settings', pageEl.hidden);
    await openSettings();
    q(pageEl, '.pf-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const stays = !pageEl.hidden;
    q(viewEl, '.pane').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    ok('a click in settings keeps it, a click on a terminal next to it closes it', stays && pageEl.hidden);

    // profiles.json edited from outside: `werkbank open` finds a new profile without a restart
    const onDisk = JSON.parse(JSON.stringify(profiles));
    await invoke('save_profiles', { profiles: [...onDisk, { name: 'Cmd3', command: ['cmd.exe'] }] });
    await API.open({ profile: 'Cmd3', name: 'Four' });
    ok('a profile added to profiles.json works without a restart', profiles.length === 3 && allSessions().find((s) => s.name === 'Four')?.profile === 'Cmd3');
    API.close({ name: 'Four' });
    await invoke('save_profiles', { profiles: onDisk });
    await syncProfiles();
    ok('and its removal too', profiles.length === 2);

    ok('a conversation that was never saved is not resumed', !(await invoke('has_conversation', { id: uid() })) && !(await invoke('has_conversation', { id: '..\\x' })));
    ok('and has no title to show', (await invoke('conversation_title', { id: uid() })) === null && (await invoke('conversation_title', { id: '..\\x' })) === null);
    $('#showall').click();
    ok('show all terminals', visible().length === allSessions().length);

    // a program that ends itself (exit 0) closes its terminal; Ctrl+Z brings it back
    const c = newSession(group(), profiles[0], null, 'Gone');
    await wait(2500);
    invoke('write', { id: c.id, data: 'exit 0\r' });
    await wait(2500);
    ok('exit in the program closes the terminal', !findSession(c.id));
    key('z', { code: 'KeyZ', ctrlKey: true });
    ok('Ctrl+Z brings it back', !!findSession(c.id));
    removeSession(c.id);
    await wait(1000);

    // keys.js: Ctrl+Tab like Alt+Tab (panes.js)
    setActive(a.id);
    setActive(b.id);
    key('Tab', { code: 'Tab', ctrlKey: true });
    const back = L.active === a.id;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }));
    key('Tab', { code: 'Tab', ctrlKey: true });
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }));
    ok('Ctrl+Tab: to the previous terminal and back again', back && L.active === b.id);
    openSwitcher();
    ok('go-to-terminal box lists both', !$('#switcher').hidden && $('#switcher').querySelectorAll('[data-k]').length === 2);
    $('#switcher input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // memory (memory.js, memory.rs): Werkbank's total with everything it runs, each terminal's program, the computer
    await tickMemory();
    ok('memory: a total in the footer, per terminal, and the computer\'s memory', /\d (MB|GB)$/.test($('#mem').textContent ?? '') && (R(a.id).mem ?? 0) > 0 && memNow.ram > memNow.total);
    // sleep: a resumable terminal out of view that waits for you stops, and continues when shown again
    const pz = profiles[0], keepResume = pz.resume;
    pz.resume = ['/k', 'echo woke-up'];
    const z = newSession(group(), pz, null, 'Sleeper');
    await wait(2000);
    z.resumable = true; // its program has a conversation (Claude after the first prompt)
    invoke('write', { id: z.id, data: 'title Kept topic\r' });
    await wait(1000);
    ok('the title its program sets is kept on the terminal (layout.json)', z.title === 'Kept topic' && label(z) === 'Kept topic');
    hide(z.id);
    z.resumable = true;
    const rz = R(z.id);
    rz.working = false; // what a Claude that finished reports
    rz.draft = true;
    ok('sleep: not with text typed but not sent', !canSleep(z));
    rz.draft = false;
    z.awake = true;
    ok('sleep: not when kept awake', !canSleep(z));
    z.awake = undefined;
    const keepBudget = L.memBudget, keepAfter = L.sleepAfter;
    L.memBudget = 0.0001; // a few MB: Werkbank is over it
    L.sleepAfter = 0;
    rz.idleSince = rz.inputAt = rz.seenAt = Date.now() - 2 * 60000;
    await tickMemory();
    ok('budget: not one that waited less than the minimum', rz.running && !z.asleep);
    rz.idleSince = rz.inputAt = rz.seenAt = Date.now() - MIN_WAIT - 60000;
    rz.busy = true;
    ok('sleep: not while it runs something it started (a background command)', !canSleep(z));
    await tickMemory(); // measures again: cmd started nothing, so it is not busy
    await wait(1500);
    L.memBudget = keepBudget;
    L.sleepAfter = keepAfter;
    ok('budget: over it, the one that waited long enough sleeps (saved, a moon in its row)',
      !rz.running && !rz.exited && !!z.asleep && !!groupsEl.querySelector(`[data-s="${z.id}"].asleep .dot svg`));
    ok('sleep: werkbank list says asleep', statusOf(z.id) === 'asleep');
    rz.title = rz.firstTitle = undefined; // as after a restart: no program has set a title yet
    ok('asleep after a restart it is still called by its kept title', label(z) === 'Kept topic');
    z.custom = true;
    ok('a name typed by hand still wins', label(z) === 'Sleeper');
    z.custom = undefined;
    show(z.id, false);
    await wait(2500);
    ok('woken when shown: it continues (resume arguments)', rz.running && !z.asleep && printed(z.id, 'woke-up'));
    await openSettings('#memory-section');
    ok('Settings > Memory lists every terminal with what it uses', pageEl.querySelectorAll('#mem-list .srow').length === allSessions().length);
    closeSettings();
    pz.resume = keepResume;
    removeSession(z.id);
    await wait(300);

    // api.js, and the real `werkbank` command over the socket (api.rs)
    ok('api: list', listTerminals()[0].terminals.length === 2);
    API.send({ name: 'One', text: 'echo sent-ok' });
    await wait(3000);
    ok('send types the text and presses Enter', printed(a.id, 'sent-ok'));
    API.open({ profile: 'Cmd2', name: 'Three', prompt: 'echo third-ok' });
    await wait(6000);
    const third = allSessions().find((s) => s.name === 'Three');
    ok('open --prompt: new terminal gets its task', !!third && printed(third.id, 'third-ok'));
    const g3 = must(findSession(must(third, 'Three').id), 'Three').g;
    g3.locked = true;
    let refused = false;
    try { API.close({ name: 'Three' }); } catch { refused = true; }
    API.close({ name: 'Three', self: true });
    await wait(600);
    ok('close: a locked group refuses, a terminal closing itself goes anyway', refused && !allSessions().some((s) => s.name === 'Three'));
    g3.locked = false;
    // Delete on a selection: a terminal in a locked group goes on the second press (sidebar.js deleteSelected)
    await API.open({ profile: 'Cmd2', name: 'Four' });
    const four = must(allSessions().find((s) => s.name === 'Four'), 'Four');
    const g4 = must(findSession(four.id), 'Four').g;
    g4.locked = true;
    toggleSelect(four.id);
    key('Delete');
    ok('Delete, locked group: the first press only arms', armed === 'del' && !!findSession(four.id) && $('#selbar').textContent.includes('Delete again'));
    key('Delete');
    ok('Delete, locked group: the second press stops it', !findSession(four.id) && !selected.size);
    key('z', { code: 'KeyZ', ctrlKey: true });
    ok('Delete, locked group: Ctrl+Z brings it back', !!findSession(four.id));
    must(findSession(four.id), 'Four').g.locked = false; // undo put back a copy of the group
    API.close({ name: 'Four' });
    // groups inside groups (groups.js, sidebar.js, api.js)
    await API.open({ profile: 'Cmd2', group: `${group().name}/Sub`, name: 'Nested' });
    const sub = must(L.groups.find((x) => x.name === 'Sub'), 'Sub');
    ok('nested group: --group Parent/Child makes the subgroup', sub.parent === group().id && allSessions().some((s) => s.name === 'Nested'));
    ok('nested group: drawn indented under its parent', !!groupsEl.querySelector(`[data-g="${sub.id}"]`)?.getAttribute('style')?.includes('--d:1'));
    ok('nested group: list shows the path', listTerminals().some((x) => x.group === `${group().name}/Sub`));
    group().collapsed = true;
    renderSide();
    ok('nested group: folding the parent hides it', !groupsEl.querySelector(`[data-g="${sub.id}"]`));
    group().collapsed = false;
    group().locked = true;
    let kept = false;
    try { API.close({ name: 'Nested' }); } catch { kept = true; }
    group().locked = false;
    ok('nested group: a locked parent protects its subgroups', kept && allSessions().some((s) => s.name === 'Nested'));
    API.close({ name: 'Nested' });
    renderSide();
    const del = groupsEl.querySelector(`[data-g="${sub.id}"] [data-act="delgroup"]`);
    if (del instanceof HTMLElement) del.click();
    ok('nested group: an empty subgroup is deleted', !!del && !L.groups.includes(sub));
    // dragging a group row (sidebar.js): the middle puts it inside the other group, the top edge beside it
    /** @type {Group} */
    const gx = { id: uid(), name: 'DragX', collapsed: false, sessions: [] };
    L.groups.push(gx);
    renderSide();
    const headOf = (/** @type {Group} */ x) => must(groupsEl.querySelector(`[data-g="${x.id}"] .ghead`), x.name);
    const dragGroup = (/** @type {Group} */ g, /** @type {Group} */ to, /** @type {number} */ fy) => {
      const from = headOf(g).getBoundingClientRect(), r = headOf(to).getBoundingClientRect();
      const at = { clientX: r.left + 40, clientY: r.top + r.height * fy, bubbles: true };
      headOf(g).dispatchEvent(new MouseEvent('mousedown', { clientX: from.left + 40, clientY: from.top + 5, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', at));
      window.dispatchEvent(new MouseEvent('mouseup', at));
    };
    const top = group(); // group() is the first one, which DragX becomes
    dragGroup(gx, top, 0.5);
    ok('drag a group onto the middle of another: inside it', gx.parent === top.id);
    dragGroup(top, gx, 0.5);
    ok('drag a group into its own subgroup: refused', !top.parent);
    dragGroup(gx, top, 0.1);
    ok('drag a group onto the top edge: beside it, back at the top level', !gx.parent && L.groups.indexOf(gx) < L.groups.indexOf(top));
    L.groups = L.groups.filter((x) => x !== gx);
    renderSide();
    // renaming a group: a double click on its name (two clicks, the first one redraws the row) opens the input, folded or not
    const nameOf = (/** @type {Group} */ x) => must(groupsEl.querySelector(`[data-g="${x.id}"] .gname`), x.name);
    await wait(50); // the click that ends a drag is ignored until this tick has passed
    const folded = !!top.collapsed;
    nameOf(top).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    nameOf(top).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    const inp = groupsEl.querySelector(`[data-g="${top.id}"] .ghead input`);
    ok('rename a group: double-click on its name opens the input, fold state unchanged', inp instanceof HTMLInputElement && !!top.collapsed === folded);
    if (inp) inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    invoke('write', { id: a.id, data: `${exe} send Two echo via-the-cli\r` });
    await wait(5000);
    ok('werkbank send from inside a terminal', printed(b.id, 'via-the-cli'));
    // from Git Bash a leading / arrives as a Windows path (C:/Program Files/Git/...); the command turns it back
    invoke('write', { id: a.id, data: `set MSYSTEM=MINGW64\rset EXEPATH=C:\\Program Files\\Git\\bin\r${exe} send Two echo "C:/Program Files/Git/slash-ok"\rset MSYSTEM=\r` });
    await wait(5000);
    ok('a / mangled by Git Bash is turned back', printed(b.id, '/slash-ok'));
    invoke('write', { id: a.id, data: `cmd /c "set WERKBANK_TOKEN=wrong&& ${exe} list"\r` });
    await wait(3000);
    ok('a wrong token is refused', text(a.id).includes('wrong or missing token'));

    // handing work over and getting the answer back (api.js, handoff.js): wait, read, label, search
    /** @typedef {{ done: boolean, code: number, text: string }} Verdict */
    const verdict = (/** @type {string} */ name) => /** @type {Verdict} */ (API.wait({ name }));
    ok('wait: no such terminal is exit code 3', verdict('Nobody').done && verdict('Nobody').code === 3);
    // Two reports work like Claude does (its title, above) and finished long ago
    const rb = R(b.id);
    rb.term.write('\x1b]0;◐ Busy\x07');
    await wait(200);
    rb.term.write('\x1b]0;✳ Busy\x07');
    await wait(300);
    ok('wait: a terminal that just finished is not done yet (it may be between two steps)', !verdict('Two').done);
    await wait(WAIT.settle);
    ok('wait: finished and settled is done, exit code 0', verdict('Two').done && verdict('Two').code === 0);
    API.send({ name: 'Two', text: 'echo handed-over' });
    ok('wait right after send: not done, the earlier "done" does not count', !verdict('Two').done);
    await wait(3000);
    ok('send typed it; wait still waits until the work has started', printed(b.id, 'handed-over') && !verdict('Two').done);
    rb.term.write('\x1b]0;◐ Busy\x07');
    await wait(200);
    ok('wait: not done while it works', !verdict('Two').done && !!rb.job?.started);
    rb.term.write('\x1b]0;✳ Busy\x07');
    await wait(300 + WAIT.settle);
    ok('wait: done once the work that was sent has ended', verdict('Two').done && verdict('Two').code === 0 && !rb.job);
    ok('read: the end of a shell\'s screen', String(await API.read({ name: 'Two', lines: 30 })).includes('handed-over'));
    let readRefused = false;
    try { await API.read({ name: 'Two', lines: -1 }); } catch { readRefused = true; }
    ok('read: --lines must be a whole number', readRefused);
    // the real command against a shell: it is done when it has been quiet for a while. cmd does not wait for
    // werkbank.exe at its prompt (it is no console program), hence start /wait
    await API.open({ profile: 'Cmd2', name: 'Five' });
    const five = must(allSessions().find((x) => x.name === 'Five'), 'Five');
    await wait(2500);
    invoke('write', { id: a.id, data: `${exe} send Five "ping -n 3 127.0.0.1 >nul & echo late-done"\rstart /wait ${exe} wait Five --timeout 60\recho wait-code-%errorlevel%\r` });
    let lateDone = false;
    for (let n = 0; n < 120 && !/^wait-code-\d/m.test(text(a.id)); n++) {
      await wait(250);
      lateDone = printed(five.id, 'late-done');
    }
    ok('werkbank wait blocks until the sent command is done and quiet, exit code 0', lateDone && printed(a.id, 'wait-code-0'));
    invoke('write', { id: a.id, data: `${exe} read Five --lines 4\r` });
    await wait(3000);
    ok('werkbank read prints the other terminal\'s screen', printed(a.id, 'late-done'));
    invoke('write', { id: a.id, data: `start /wait ${exe} wait Nobody\recho gone-code-%errorlevel%\r` });
    await wait(3000);
    ok('werkbank wait: exit code 3 for a terminal that is not there', printed(a.id, 'gone-code-3'));
    API.close({ name: 'Five' });
    // a label: set by a program on its own terminal, shown in the sidebar and the go-to box, kept out of undo
    const tagOf = () => findSession(a.id)?.s.tag;
    invoke('write', { id: a.id, data: `${exe} label #1072 waiting\r` });
    await wait(3000);
    ok('werkbank label: on the terminal it runs in, shown in its row', tagOf() === '#1072 waiting' && groupsEl.querySelector(`[data-s="${a.id}"] .stag`)?.textContent === '#1072 waiting');
    ok('label: werkbank list shows it', listTerminals().some((x) => x.terminals.some((t) => t.id === a.id && t.label === '#1072 waiting')));
    openSwitcher();
    const sw = q(document, '#switcher'), swInput = /** @type {HTMLInputElement} */ (q(sw, 'input'));
    swInput.value = '1072';
    swInput.dispatchEvent(new Event('input'));
    ok('go-to box: finds a terminal by its label', sw.querySelectorAll('.sw-list button').length === 1 && q(sw, '.sw-list .stag').textContent === '#1072 waiting');
    swInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    checkpoint('selftest');
    API.label({ name: a.id, text: `<b>${'x'.repeat(40)}` });
    undo();
    ok('label: cut to one short line, escaped, and not taken back by undo', tagOf() === `<b>${'x'.repeat(21)}` && !groupsEl.querySelector('.stag b'));
    API.label({ name: a.id, text: '' });
    ok('label: an empty text takes it off', tagOf() === undefined && !groupsEl.querySelector('.stag'));
    // search: no Claude terminals here (two cmd profiles), so only that the question gets through
    ok('search: nothing found without Claude conversations', /** @type {unknown[]} */ (await API.search({ text: 'handed-over' })).length === 0);
    let searchRefused = false;
    try { await API.search({ text: 'x' }); } catch { searchRefused = true; }
    ok('search: needs two characters', searchRefused);
    // the go-to box and the command ask Rust in their own way (replacing the box's earlier search, or not)
    ok('search: both ways of asking get an answer', (await searchConversations('handed-over', true)).length === 0 && (await invoke('search_conversations', { ids: [a.id, 'not an id'], query: 'handed-over', replaces: true })).length === 0);
    // the away command (attention.js, away.rs): off by default; a dummy command checks what it got and leaves a file
    ok('away command: off by default', !L.awayCommand);
    invoke('write', { id: a.id, data: 'del "%TEMP%\\wb-selftest-away.txt" 2>nul\r' });
    setActive(a.id);
    rb.term.write('\x1b]0;◐ Busy\x07');
    await wait(200);
    rb.term.write('\x1b]0;✳ Busy\x07');
    await wait(300);
    L.awayCommand = `cmd.exe /c "if %WERKBANK_AWAY_ID%-%WERKBANK_AWAY_MINUTES%==${b.id}-0 echo away-ok> %TEMP%\\wb-selftest-away.txt"`;
    L.awayAfter = 30;
    await tickAway();
    ok('away command: not before the minutes have passed', !!rb.attn && rb.awayFor === undefined);
    const since = rb.attnAt;
    await wait(20);
    attention(b.id);
    ok('away command: a second bell while it waits does not start the wait again', rb.attnAt === since);
    L.awayAfter = 0; // no waiting, and the PC counts as left alone
    await tickAway();
    ok('away command: not for a program that is not Claude, whatever its title says', rb.awayFor === undefined);
    // from here Two counts as a Claude terminal: its profile's program is called claude (cmd keeps running in it)
    const pb = profileOf(b), realCommand = pb.command;
    pb.command = ['claude.exe'];
    await tickAway();
    await wait(1500);
    invoke('write', { id: a.id, data: 'type "%TEMP%\\wb-selftest-away.txt"\r' });
    await wait(1500);
    ok('away command: runs for a finished, unseen terminal, which it gets in its environment', rb.awayFor === rb.attnAt && printed(a.id, 'away-ok'));
    invoke('write', { id: a.id, data: 'del "%TEMP%\\wb-selftest-away.txt"\r' });
    await tickAway();
    await wait(1500);
    invoke('write', { id: a.id, data: 'if not exist "%TEMP%\\wb-selftest-away.txt" echo away-once\r' });
    await wait(1500);
    ok('away command: once per wait', printed(a.id, 'away-once'));
    L.awayCommand = L.awayAfter = undefined;
    pb.command = realCommand;
    await openSettings();
    ok('Settings > Notifications has the away command, empty', /** @type {HTMLInputElement} */ (q(pageEl, '[data-k="awayCommand"]')).value === '' && !!pageEl.querySelector('[data-k="awayAfter"]'));
    closeSettings();

    // the content security policy must not block what Werkbank itself uses
    ok('csp: program icons shown', [...document.querySelectorAll('img.picon')].some((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0));
    ok('csp: bundled fonts and about.json load', APP.components.length > 0 && document.fonts.check('14px "JetBrains Mono"'));
    ok(`csp: nothing blocked ${blocked.join(' | ')}`, blocked.length === 0);
  } catch (e) {
    report.push(`FAIL ${e instanceof Error ? e.stack ?? e : e}`);
  }
  const failed = report.filter((l) => !l.startsWith('PASS')).length;
  report.push(`${report.length - failed} passed, ${failed} failed`);
  invoke('selftest_done', { report: report.join('\n'), passed: failed === 0 });
})();
