// Answers the `werkbank` command run inside a terminal (src-tauri/src/api.rs): list, open, send, close.

const statusOf = (/** @type {string} */ id) => { const r = rt.get(id); return r?.exited ? 'exited' : r?.running ? 'running' : r?.starting ? 'starting' : 'idle'; };
// The arguments come from any program that has the token, so each is checked before use.
/** @param {Record<string, unknown>} a @param {string} k @returns {string} '' when not given */
const argText = (a, k) => { const v = a[k] ?? ''; if (typeof v !== 'string') throw new Error(`${k} must be text`); return v; };
/** @param {Record<string, unknown>} a @param {string} k */
const argFlag = (a, k) => { const v = a[k] ?? false; if (typeof v !== 'boolean') throw new Error(`${k} takes no value`); return v; };
/** @param {Record<string, unknown>} a @returns {{ g: Group, s: Session }} the terminal named by `a.name` (name, title or id) */
function findTerminal(a) {
  const q = argText(a, 'name'), k = q.toLowerCase();
  if (!k) throw new Error('which terminal? give its name or id (see: werkbank list)');
  const hits = L.groups.flatMap((g) => g.sessions.filter((x) => x.id === k || (k.length >= 4 && x.id.startsWith(k))
    || label(x).toLowerCase() === k || x.name.toLowerCase() === k).map((s) => ({ g, s })));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`no terminal called "${q}" (see: werkbank list)`);
  throw new Error(`"${q}" matches ${hits.length} terminals; use the id from werkbank list`);
}
// `werkbank send` / `open --prompt`: types text into a terminal and presses Enter, like you would. Only text gets
// through (control characters and escape codes are dropped, so it cannot press other keys); several lines go in
// as one paste. A terminal that is not running yet is started first, and the text waits until the program has been
// quiet for a moment (Claude Code takes a few seconds to load).
// Cut by characters, not UTF-16 units: half an emoji would make the whole write fail.
const sendable = (/** @type {string} */ t) => Array.from(t.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\t\n]/gu, '')).slice(0, 20000).join('');
/** @param {Session} s @param {string} text */
async function typeInto(s, text, enter = true) {
  const r = runtime(s);
  if (!r.running && !r.starting) start(s);
  // Claude sets its window title once its input box is up; text typed before that can get lost
  // shortcut: a Claude started with its title turned off waits the full 90 s, then nothing is typed
  const ready = () => r.running && r.lastOutput && Date.now() - r.lastOutput > 1500 && (r.title !== undefined || !isClaude(profileOf(s)));
  for (const t0 = Date.now(); !ready();) {
    if (rt.get(s.id) !== r) return; // removed in the meantime
    if (Date.now() - t0 > 90000 || r.exited) {
      r.term.write('\r\n\x1b[90m[werkbank send: the program did not get ready, nothing was typed]\x1b[0m\r\n');
      return;
    }
    await pause(250);
  }
  // straight to the program (xterm's own paste needs a terminal that has been shown), as a paste: bracketed when the
  // program asked for it, so several lines arrive as one input instead of one Enter per line
  const body = text.replace(/\n/g, '\r');
  await writeTo(r, s.id, r.term.modes.bracketedPasteMode ? `\x1b[200~${body}\x1b[201~` : body);
  if (!enter) return;
  await pause(200); // let the program take the paste in before Enter
  writeTo(r, s.id, '\r');
  // same as Enter typed by hand (terminal.js): the program now has a conversation, so a restart resumes it
  if (!s.resumable && profileOf(s)?.resume) { s.resumable = true; save(); }
  // evidence for the log when a prompt did not arrive (start() then begins fresh instead of resuming)
  if (isClaude(profileOf(s))) setTimeout(async () => {
    if (findSession(s.id) && !(await invoke('has_conversation', { id: s.id }).catch(() => true))) log(`${s.name}: the typed prompt did not start a conversation`);
  }, 30000);
}

// --group takes "Name" or "Parent/Child"; a plain name that is no top-level group still finds a subgroup of that name.
/** @param {string} path */
function findGroup(path) {
  const key = path.trim().toLowerCase(), tree = groupTree(L.groups);
  return (tree.find(({ g }) => groupPath(L.groups, g).toLowerCase() === key) ?? tree.find(({ g }) => g.name.toLowerCase() === key))?.g;
}
// The group at that path; the ones missing on the way are made.
/** @param {string} path @returns {Group} */
function ensureGroup(path) {
  const names = path.split('/').map((x) => x.trim()).filter(Boolean);
  /** @type {Group | undefined} */
  let g;
  for (const name of names.length ? names : ['General']) {
    const parent = g;
    g = L.groups.find((x) => x.parent === parent?.id && x.name.toLowerCase() === name.toLowerCase());
    if (!g) {
      g = { id: uid(), name, collapsed: false, sessions: [] };
      if (parent) g.parent = parent.id;
      L.groups.push(g);
    }
  }
  return /** @type {Group} */ (g); // the loop runs at least once
}

// werkbank list: the groups with their terminals
function listTerminals() {
  const shown = visible();
  return groupTree(L.groups).map(({ g }) => ({
    group: groupPath(L.groups, g), locked: isLocked(L.groups, g),
    terminals: g.sessions.map((x) => ({ name: label(x), id: x.id, profile: x.profile, status: statusOf(x.id), visible: shown.includes(x.id) })),
  }));
}

/** @type {Record<string, (a: Record<string, unknown>) => unknown>} */
const API = {
  list: listTerminals,
  open: async (a) => {
    const profile = argText(a, 'profile'), group = argText(a, 'group'), split = argText(a, 'split'), show = argFlag(a, 'show');
    if (split && split !== 'right' && split !== 'down') throw new Error(`--split is right or down, not "${split}"`);
    const prompt = sendable(argText(a, 'prompt'));
    await syncProfiles(); // a profile just added to profiles.json works right away
    const named = profile ? profiles.find((x) => x.name.toLowerCase() === profile.toLowerCase()) : undefined;
    if (profile && !named) throw new Error(`no profile "${profile}" (profiles: ${profiles.map((x) => x.name).join(', ')})`);
    let g = group ? findGroup(group) : (L.active && findSession(L.active)?.g) || L.groups[0];
    const p = named ?? groupProfile(g);
    if (!p) throw new Error('there are no profiles (see profiles.json)');
    if (!g) {
      const name = group || 'General';
      checkpoint(`new group ${name}`);
      g = ensureGroup(name);
    }
    const name = argText(a, 'name') || uniqueName(p.name);
    /** @type {Session} */
    let s;
    if (split || show) {
      s = newSession(g, p, split && L.active ? { target: L.active, dir: split === 'down' ? 'col' : 'row' } : null, name);
    } else { // in the background: it runs and shows up in the sidebar, the window is left alone
      checkpoint(`open ${name}`);
      s = takeSession(p, name, g);
      g.sessions.push(s);
      start(s);
      renderSide();
      save();
    }
    if (a.name) { s.custom = true; renderSide(); save(); }
    if (prompt.trim()) typeInto(s, prompt);
    return `opened "${name}" (${p.name}) in group ${groupPath(L.groups, g)}${split || show ? '' : ' in the background'}  id ${s.id.slice(0, 8)}`
      + (prompt.trim() ? '; the prompt is typed in once it is ready' : '');
  },
  send: (a) => {
    const { s } = findTerminal(a), text = sendable(argText(a, 'text')), enter = !argFlag(a, 'no-enter');
    if (!text.trim()) throw new Error('nothing to send (control characters are dropped)');
    // answered at once: typing waits for the program, which can take longer than the command line waits
    typeInto(s, text, enter);
    return `${enter ? 'sent to' : 'typed into'} "${label(s)}"${rt.get(s.id)?.running ? '' : ' (starting it first)'}`;
  },
  close: (a) => {
    const { g, s } = findTerminal(a), was = label(s), self = argFlag(a, 'self');
    // a locked group keeps its terminals, except one that closes itself (a coding agent asked to end its own session)
    if (isLocked(L.groups, g) && !self) throw new Error(`"${was}" is in locked group ${groupPath(L.groups, g)}; unlock the group (or its parent) first`);
    if (!self) removeSession(s.id);
    // answered first, removed just after (removing stops the program that asked); Ctrl+Z brings it back
    else setTimeout(() => {
      if (!findSession(s.id)) return;
      checkpoint(`close ${was}`);
      dropFromGroups([s.id]);
      renderView();
    }, 300);
    return `closed "${was}"`;
  },
};
// A clicked Windows notification (see notify.rs) asks to show its terminal.
listen('show-terminal', ({ payload: id }) => { if (findSession(id)) reveal(id); });

// api.rs checks the shape (cmd a string, args an object); the values in args are checked by each command
listen('api-request', async ({ payload: { id, cmd, args } }) => {
  let reply;
  try {
    if (!Object.hasOwn(API, cmd)) throw new Error(`unknown command "${cmd}" (see: werkbank help)`);
    const result = await API[cmd](args);
    reply = { ok: true, result };
    if (cmd !== 'list') log(`werkbank ${cmd}: ${result}`); // the result names the terminal, not the sent text
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    reply = { ok: false, error };
    log(`werkbank ${cmd} refused: ${error}`);
  }
  invoke('api_reply', { id, reply }).catch(() => {});
});
