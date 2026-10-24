# CLAUDE.md — Werkbank

Werkbank is a terminal workspace for Windows: grouped terminals in a sidebar, split panes, Claude Code sessions that
resume. Tauri 2 (Rust) + plain JavaScript + xterm.js. Everything user-facing is in English (code, UI, docs, commits).

## Where things are

| Path | What |
|---|---|
| `ui/base.js` | Loaded first: shared state (`L` persisted layout, `profiles`, `rt` runtime per terminal), helpers, icons, `save`, undo. Undo restores groups and terminals in place, so a held session object stays live |
| `ui/menus.js` | Every right-click menu, and the clipboard (`copySelection`, `pasteInto`) |
| `ui/links.js` | Ctrl+click file links (`path:line`) in terminal output, opened by `open_file` (main.rs, editor.rs) |
| `ui/terminal.js` | One terminal: xterm + pane, start/stop its program, new / remove terminals, warm sessions, file drop |
| `ui/panes.js` | The window: split tree, show / hide / place, maximize, focus, Alt+arrows |
| `ui/sidebar.js` | Groups and terminals in the sidebar: rows, selection, rename, dragging (also panes by their title) |
| `ui/attention.js` | Chime, blinking, Windows notification, taskbar count |
| `ui/settings.js` | Settings page: themes, fonts, sizes, profiles, groups, startup |
| `ui/window.js` | Frameless window: title bar, full screen, sidebar width |
| `ui/keys.js` | Keyboard shortcuts, go-to-terminal box |
| `ui/api.js` | Answers the `werkbank` command (list / open / send / close) |
| `ui/main.js` | Loaded last: startup, saving on quit |
| `ui/selftest.js` | The checks of `werkbank --selftest`; only loaded in that mode |
| `ui/style.css` | All styling; theme colors are CSS variables set by `applySettings()` |
| `ui/tree.js` | Split tree helpers (`leaves`, `without`, `splitAt`, `grid`, `spotOf`, `swap`), tested by `ui/tree.test.js` |
| `ui/groups.js` | Groups inside groups: `L.groups` stays one flat list with an optional `parent`; `groupTree` (sidebar order), `subtree`, `groupPath`, `isLocked` (a lock covers the subgroups), `moveGroup`; tested by `ui/groups.test.js` |
| `ui/schemes.js`, `ui/themes.js` | Terminal color schemes and app themes |
| `src-tauri/src/main.rs` | Wiring: plugins, window, single instance, global hotkey, small commands (icons, links, quit) |
| `src-tauri/src/pty.rs` | The programs in the terminals: spawn / write / resize / kill (ConPTY). `write` only queues: one writer thread per terminal keeps the keystrokes in order and blocks nothing else |
| `src-tauri/src/store.rs` | Files in %APPDATA%: profiles.json, layout.json, screens, the log |
| `src-tauri/src/api.rs` | Local control API + the `werkbank list/open/close/send` command line client |
| `src-tauri/src/notify.rs` | Windows notifications and the link a click on one opens |
| `src-tauri/src/icon.rs`, `expand.rs` | Program icons from .exe files; `%VAR%` expansion |
| `ui/types.d.ts` | The shared types for `tsc`: layout.json (`Layout`, `Group`, `Session`, `TreeNode`), `Profile`, `Runtime`, and every Rust command (`Commands`) and event (`Events`) with its arguments and result, so `invoke` and `listen` are checked |
| `build.sh` | Runs inside the `werkbank-build` image: vendor files, fonts, tests, cross-compile to Windows |

Config lives in `%APPDATA%\nl.dlabs.werkbank\`: `profiles.json` (user-editable, also via Settings > Profiles; re-read on focus, Settings and `werkbank open`),
`layout.json` (owned by the UI, written atomically), `screens\` (saved shell screens), `logs\werkbank.log` (errors,
terminals that stopped, `werkbank` commands; `log()` in the UI, `store::write_log` in Rust; Settings > About opens it).

## Build and test

```sh
docker build -t werkbank-build -f build/Dockerfile build
docker run --rm -v "$PWD":/src -v werkbank-cargo:/usr/local/cargo/registry -v werkbank-xwin:/root/.cache werkbank-build ./build.sh
```

- `build.sh` stops at the first failure of:
  - `node ui/*.test.js` (tree.js, links.js)
  - `tsc` in strict mode over every `ui/*.js` (types as JSDoc, shared ones in `ui/types.d.ts`)
  - ESLint (`eslint.config.mjs`) with `no-undef` on: the names the scripts share are read from the scripts themselves
    (espree, in index.html order), so a misspelled global fails the build instead of the startup
  - `cargo fmt --check` (the official Rust style guide), clippy on all targets with warnings as errors
  - the native tests of `expand.rs` and `editor.rs`
- It also builds `werkbank-tests.exe` (the Rust tests that need Windows, e.g. api.rs): run it on Windows next to the
  selftest; exit 0 = all passed. Run `cargo fmt` before committing.
- After every build, before installing it: run `werkbank.exe --selftest` on Windows (next to a running Werkbank is
  fine). It runs `ui/selftest.js` against that exe in a throwaway folder with two cmd profiles and its own WebView2
  data, prints one PASS/FAIL line per check and exits 0 only when all passed. A new feature or a fixed bug gets a
  check there.
- UI changes: also look at them in the running app, not just by reading.

## Installing a build over a running Werkbank

- Werkbank is the user's working environment all day: **never close, stop or start it** for them, not even "cleanly".
  They restart it when they want to.
- After `--selftest` exits 0: rename the running `%LOCALAPPDATA%\Programs\Werkbank\werkbank.exe` to `werkbank.old.exe`
  (Windows allows renaming a running exe; delete an older `werkbank.old.exe` first, it is not running), copy the new
  exe in its place and say that it is ready for the next restart.
- Never start a second instance next to a running one: both would write the same `layout.json`.

## UI rules: the same thing looks and works the same everywhere

### One icon per meaning

| Meaning | Icon | Used for |
|---|---|---|
| Add / new | `plus` | new terminal, add profile |
| New group | `folderPlus` | sidebar header |
| Close, hide, dismiss — nothing is lost | `x` | hide a pane (keeps running), close Settings / find box, clear selection, window close, no color |
| Stop, remove, delete — something ends | `trash` | stop a terminal, close a group's terminals, delete an empty group, delete a profile, stop the selection |
| Show side by side | `grid` | show a group, show the selection |
| Split | `splitRight` / `splitDown` | pane bar, terminal menu |
| Lock | `lock` / `unlock` | group lock |
| Undo / back to default | `undo` | undo, reset the accent color |
| Default | `star` | make a profile the default |
| Choose a folder | `folder` | browse buttons |
| Try / preview | `play` | test the notification |
| Find | `search` · `up` / `down` | find box |
| Copy / paste | `copy` / `paste` | terminal menu |
| Fold open / closed | `chevron` (rotated when open) | groups, profile rows |
| Maximize / restore | `max` / `restore` | window, a pane (Ctrl+Shift+Enter) |

- A new meaning gets a new icon in `ICONS` (16px grid, stroke 1.4, round caps and joins); never reuse an icon for a
  different meaning, and never give one meaning two icons.
- Program icons come from `progIcon()` (the .exe's icon, or a letter badge); they never stand for an action.

### Buttons, menus, text

- Buttons are **icon-only** with a `title` tooltip that names the action and its shortcut, e.g.
  `Split right (Alt+Shift+=)`. The only text button is the call to action on the empty screen.
- Menus (right click) list **icon + text**.
- Destructive actions (`trash`) either ask for a second click within 3 s (`confirmed(key)`, the button turns red)
  or act at once and are undoable (`checkpoint()` + Ctrl+Z); the Delete key acts at once because Ctrl+Z exists.
  Locked groups never lose terminals, except one that closes itself (`werkbank close` without a name: a coding agent
  ending its own session).
- Text: short, sentence case, plain words; explain a setting in its row's hint, not in a dialog.

### Look

- Colors only through the theme variables (`--side --bg --fg --mut --acc --tbg --tfg`, plus `--hover --edge`).
  Fixed colors only for status: running `#3fb950`, danger `#e5484d`, attention `#f59e0b`.
- The chrome scales with the interface size (`zoom: var(--ui)`); terminals never do (xterm measures its own font).
- Settings: one compact row per item (like Settings > Profiles); details open in place, one at a time.
- Paths, commands and options are shown in the code font (Cascadia Mono).
- The app icon is a full square in the accent blue to the very edge (no rounded, transparent corners) with a white W.

## Code rules

- Plain browser JS, no framework or bundler; third-party files are copied into `ui/vendor` by `build.sh`. Kept on
  purpose (architecture review 2026-10-21): the one-step build and the strict CSP are worth more than modules at this
  size. When the UI is about twice as big or gets a second window, the step up is `<script type="module">` with the
  same files and explicit imports, not a bundler.
- The `ui/*.js` files are classic scripts that share one global scope, loaded in the order of `index.html`. Code
  that runs while a file loads may only use what earlier files define; functions called later can use anything.
  A new file goes into `index.html` in the right place; a name is declared in one file only.
- Reuse the helpers instead of writing the pattern again: `checkpoint` (undo step), `drop` (stop + forget a
  terminal), `confirmed` (click twice), `showMenu`, `drag`, `changed` (apply + save + redraw settings),
  `place` / `show` / `hide` / `showGrid`, `newSession` / `takeSession`, `groupProfile`, `saveProfiles`.
- Anything that changes which terminals are in the window leaves the settings page (`place`, `show`, `showGrid` do).
- Drawing is split from what follows it. `renderView()` = `buildView()` (the split layout as DOM, nothing else) +
  `renderSide()` + `save()` + `settleView()` in the next frame (fit the panes, start what should run, give the keyboard
  back to the active terminal unless it was in something that still exists, like a Settings field). Put a new side
  effect in `settleView` or in the caller that means it, never in `buildView` or `renderSide`. A change that only
  shows in the sidebar calls `renderSide()` + `save()`.
- Undo is a JSON snapshot (`checkpoint` / `undo` in base.js). What it takes back is exactly the `Snapshot` fields
  (groups with their terminals, split tree, active terminal, pane spots, profiles); settings, the maximized pane,
  the selection and the sidebar width are not undoable on purpose. A new `Layout` field goes into one of these two
  lists (the comment above `Snapshot`).
- Every change to groups, terminals or the split tree starts with `checkpoint('what')`.
- State: `L` is persisted (`save()`), `profiles` via `saveProfiles()`, `rt` is runtime only.
- Types: every function gets JSDoc types (`@param`, `@returns`); a field added to a saved or runtime object goes into
  `ui/types.d.ts` first, a new Rust command into `Commands`. No `any`, no `@ts-ignore`, no `eslint-disable`; a cast
  (`/** @type {T} */ (x)`) only where it is guaranteed true, e.g. an element from the file's own template. A value that
  can really be missing (a terminal closed meanwhile: `findSession`, `rt.get`) is checked, not cast.
- Never name a global after a browser one (`history`, `find`, `name`, `status`, ...): it shadows `window.*`.
- Comments explain why, in one line where possible. Keep a change as small as the task allows.
- Something that fails without the user seeing why goes into the log (`log(...)`; `console.error` lands there too).
- Rust: each subject in its own module (`pty`, `store`, `api`, `notify`, `icon`, `editor`); `main.rs` only wires
  them up. Every `unsafe` block is as small as the call it wraps and has a `// SAFETY:` comment on why it is sound
  (clippy denies it otherwise). Pure logic without Tauri goes where it can be tested natively (like `expand.rs`).

## Security

- Text from programs (titles, output) and from files (names, paths) goes into HTML only through `esc()`. The CSP in
  `tauri.conf.json` (scripts only from the app itself) is the second line of defense: an injected script could
  start programs through `spawn`. Keep inline scripts and `eval` out, so the CSP can stay strict.
- Anything that opens or runs something validates its input (`open_url` only takes http/https; screen ids only hex).
- File links: any program can print a path, so `open_file` never runs the file: no ShellExecute "open", Notepad by
  its full path as the fallback, `{file}` is never filled into the program, and network paths (`\\server\...`, also via
  the terminal's folder) are refused, because only checking one makes Windows connect and send the login.
- The control API listens on 127.0.0.1 only, needs the token (compared in constant time) and reads at most one line
  of 1 MB. Every program inside a Werkbank terminal has the token; that is by design (`werkbank send` included, a
  deliberate choice). It is not passed on over ssh, so remote hosts cannot use it.
- Files are written atomically (`write_atomic`); config stays in %APPDATA%, never next to the exe.
- The programs in the terminals are in a Windows job that ends them with Werkbank (also after a crash), so none keeps
  running unseen; what they start themselves breaks away. The log holds no typed or sent text, only names.
- Commits: English, `type: summary`, a body with the why.
