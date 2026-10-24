// ESLint: the recommended rules plus a few that keep the code plain; types across files are tsc's job.
import js from '@eslint/js';
import globals from 'globals';
import { readFileSync } from 'node:fs';
import * as espree from 'espree';

// The UI scripts share one global scope (index.html loads them in order): every top-level name of one file is a global
// for the others. Read from the files themselves with ESLint's own parser, so no-undef catches a typo without a list
// to keep up to date.
/** @param {any} p a declared name or destructuring pattern @returns {string[]} */
const idsOf = (p) => p.type === 'Identifier' ? [p.name]
  : p.type === 'ObjectPattern' ? p.properties.flatMap((x) => idsOf(x.value ?? x.argument))
    : p.type === 'ArrayPattern' ? p.elements.filter(Boolean).flatMap(idsOf)
      : p.type === 'AssignmentPattern' ? idsOf(p.left) : p.type === 'RestElement' ? idsOf(p.argument) : [];
const scripts = [...readFileSync('ui/index.html', 'utf8').matchAll(/<script src="(?!vendor\/)([^"]+)"/g)].map((m) => m[1]);
const shared = Object.fromEntries(scripts.flatMap((f) => espree.parse(readFileSync(`ui/${f}`, 'utf8'), { ecmaVersion: 2023 }).body
  .flatMap((n) => n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' ? [[n.id.name, 'readonly']]
    : n.type === 'VariableDeclaration' ? n.declarations.flatMap((d) => idsOf(d.id)).map((x) => [x, n.kind === 'let' ? 'writable' : 'readonly'])
      : [])));
// what ui/vendor (xterm.js and its addons) defines
const vendor = Object.fromEntries(['Terminal', 'FitAddon', 'CanvasAddon', 'SerializeAddon', 'SearchAddon', 'WebLinksAddon'].map((n) => [n, 'readonly']));

export default [
  { ignores: ['ui/vendor/**', 'src-tauri/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['ui/**/*.js'],
    ignores: ['ui/*.test.js'], // Node scripts: they only get what they require
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, ...vendor, ...shared } },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', caughtErrors: 'none' }],
      // each file declares its own names, which are also in `shared` for the others
      'no-redeclare': ['error', { builtinGlobals: false }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      // off: a top-level let is often assigned in another file (L in main.js), which ESLint cannot see
      'prefer-const': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-shadow': 'off',
    },
  },
  { files: ['ui/*.test.js', 'build/**/*.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
];
