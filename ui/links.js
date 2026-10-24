// File links in terminal output: Ctrl+click on path:line[:col] opens that file at that line in your editor (set under
// Settings > Terminal; without one, open_file in main.rs picks VS Code or Notepad++, else Notepad).

// path:line[:col] (most tools, Claude Code), path(line[,col]) (MSVC, C#, TypeScript) and "path", line n (Python).
// A path needs an extension, so times (12:30) and plain words are no links.
// shortcut: no spaces in paths and no paths wrapped over two lines; match quoted paths if those turn up.
const FILE_LINK = /((?:[A-Za-z]:)?[\w.~\\/-]*\w\.[A-Za-z0-9]+)(?::(\d+)(?::(\d+))?|\((\d+)(?:, ?(\d+))?\)|", line (\d+))/g;

/**
 * The file links in one line of text.
 * @param {string} text
 * @returns {{ start: number, end: number, path: string, line: number, col: number | null }[]} start and end (exclusive)
 *   are offsets in `text`
 */
function fileLinksIn(text) {
  const links = [];
  for (const m of text.matchAll(FILE_LINK)) {
    // part of a word or of a web link (https://host/a.js:3, which the web-links addon handles)
    if (/[\w:]/.test(text[m.index - 1] ?? ' ')) continue;
    const [all, path, l1, c1, l2, c2, l3] = m;
    const col = c1 ?? c2;
    links.push({ start: m.index, end: m.index + all.length, path, line: Number(l1 ?? l2 ?? l3), col: col ? Number(col) : null });
  }
  return links;
}

/**
 * The Ctrl+click file links of one terminal (xterm asks per line the mouse is over).
 * @param {Session} s
 * @param {import('@xterm/xterm').Terminal} term
 * @returns {import('@xterm/xterm').ILinkProvider}
 */
function fileLinkProvider(s, term) {
  return {
    provideLinks(y, show) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return show(undefined);
      // the line's text and the cell column of each character (a wide character takes two cells)
      let text = '';
      /** @type {number[]} */
      const cols = [];
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        const ch = cell.getChars() || ' ';
        text += ch;
        for (let i = 0; i < ch.length; i++) cols.push(x + 1);
      }
      const links = fileLinksIn(text).map((l) => ({
        range: { start: { x: cols[l.start], y }, end: { x: cols[l.end - 1], y } },
        text: text.slice(l.start, l.end),
        activate: (/** @type {MouseEvent} */ e) => { if (e.ctrlKey) openFileLink(s, l); },
      }));
      show(links.length ? links : undefined);
    },
  };
}

/** @param {Session} s @param {{ path: string, line: number, col: number | null }} link */
function openFileLink(s, { path, line, col }) {
  invoke('open_file', {
    path: path.replace(/^\/([a-z])\//i, '$1:/'), // Git Bash writes C:\ as /c/
    line,
    col,
    cwd: s.cwd ?? profileOf(s).cwd ?? null, // where its program started, as in start()
    editor: L.editor?.trim() || null,
  }).catch((e) => log(`${s.name}: could not open ${path}: ${e}`));
}
