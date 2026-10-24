// Writes ui/vendor/about.json: the bundled components and their exact versions, shown under Settings > About.
// Versions come from node_modules and Cargo.lock, so they never drift from what was actually built.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const npm = (p) => require(path.join(root, 'node_modules', p, 'package.json')).version;
const lock = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8');
const crate = (n) => lock.match(new RegExp(`name = "${n}"\\r?\\nversion = "([^"]+)"`))?.[1];

const about = [
  { name: 'Tauri', version: crate('tauri'), license: 'MIT / Apache-2.0' },
  { name: 'tauri-plugin-window-state', version: crate('tauri-plugin-window-state'), license: 'MIT / Apache-2.0' },
  { name: 'portable-pty', version: crate('portable-pty'), license: 'MIT' },
  { name: 'xterm.js', version: npm('@xterm/xterm'), license: 'MIT' },
  { name: 'xterm.js fit addon', version: npm('@xterm/addon-fit'), license: 'MIT' },
  { name: 'xterm.js serialize addon', version: npm('@xterm/addon-serialize'), license: 'MIT' },
  { name: 'Terminal color schemes (via terminalcolors.com)', version: 'each by its original author', license: 'see each scheme' },
  { name: 'Coding fonts (Fontsource)', version: 'JetBrains Mono, Fira Code, Source Code Pro', license: 'SIL OFL 1.1' },
];
const missing = about.filter((a) => !a.version).map((a) => a.name);
if (missing.length) throw new Error(`no version found for: ${missing.join(', ')}`);
fs.writeFileSync(path.join(root, 'ui', 'vendor', 'about.json'), `${JSON.stringify(about, null, 2)}\n`);
console.log('about.json:', about.map((a) => `${a.name} ${a.version}`).join(', '));
