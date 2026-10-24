// Terminal color schemes (from schemes.js) and app themes, chosen independently of each other.

// `term` is the xterm.js theme of the terminal panes; `tone` groups them in Settings (dark / medium / light).
const THEMES = Object.fromEntries(SCHEMES.map(({ name, tone, ...term }) => [name, { tone, term }]));

// App themes: the window chrome (title bar, sidebar, menus, settings).
// side = title bar + sidebar, bg = the area around the terminals, fg / mut = text, acc = accent.
const UI_THEMES = {
  Graphite: { side: '#141518', bg: '#1c1d21', fg: '#e6e7ea', mut: '#8b8e97', acc: '#5b8cff' },
  Midnight: { side: '#0d1220', bg: '#141b2d', fg: '#dfe6f5', mut: '#7f8aa6', acc: '#7c9cff' },
  Espresso: { side: '#171411', bg: '#201c18', fg: '#ede5da', mut: '#9b8f81', acc: '#e3a35a' },
  Forest: { side: '#101613', bg: '#17201b', fg: '#e1ebe4', mut: '#82948a', acc: '#4fbf8a' },
  Light: { side: '#e9ebef', bg: '#f7f8fa', fg: '#1d2026', mut: '#69707d', acc: '#2563eb', light: true },
};
