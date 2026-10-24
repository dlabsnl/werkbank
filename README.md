# Werkbank

A terminal workspace for Windows, built for running several AI coding agents and shells side by side.

- **Groups** in a resizable sidebar, with terminals underneath them.
- **Splits**: divide the window horizontally and vertically, and drag the dividers to resize.
- A **translucent name bar** on every pane, with split buttons and ×.
- **Activity dots** show which terminal has new output while you were looking elsewhere.
- **Continues where you left off**: groups, splits and window size come back, Claude Code panes resume their own conversation, and other terminals show their last screen.
- **Settings page** with separate app themes (Graphite, Midnight, Espresso, Forest, Light) and 14 popular terminal color schemes (5 dark, 4 medium, 5 light), interface size, accent color, the five most popular coding fonts (Cascadia Code, JetBrains Mono, Fira Code, Source Code Pro, Consolas), font size (the number next to the slider is drawn at the size the terminals get) and cursor style.
- **One window**: starting Werkbank again brings the running one to the front.
- **Frameless window** with its own title bar that follows the theme, and full screen with **F11**.

Werkbank is Dutch for *workbench*.

## Usage

| Action | How |
|---|---|
| New group | **+ group** at the top of the sidebar |
| New terminal | Click **+** next to a group for its profile, right-click it to pick one |
| Profiles | Settings > Profiles: the default profile, and per profile its program, options (e.g. leave out `--dangerously-skip-permissions`) and start folder |
| Profile and folder for a group | Settings > Groups, or right-click the group > Profile and folder: new terminals in it start with that profile, in that folder |
| Several at once | Right-click **+**, pick 2, 3, 4, 6 or 8 at the top of the menu, then a profile: they open in a grid (4 = 2×2, 6 = 3 columns of 2, 8 = 4 columns of 2) |
| Show a terminal alone | Click it in the sidebar |
| Split a pane | Split buttons in its name bar (right-click to pick a profile), or **Alt+Shift+=** (right) / **Alt+Shift+-** (down) |
| Split with an existing terminal | Drag it from the sidebar onto the left, right, top or bottom edge of a pane |
| Show a whole group | **▦** next to the group (with its subgroups) |
| Group inside a group | The folder button on a group row. Or drag a group onto the middle of another group's row (the top and bottom edge put it beside that group) |
| Reorder groups and terminals | Drag a group by its row, or a terminal onto another terminal (above / below it, also into another group) |
| Move a terminal to another group | Drag it onto that group |
| Close a terminal from inside | `/exit` in Claude or `exit` in a shell closes it (Ctrl+Z brings it back); in a locked group it stays, stopped |
| Bring to front when done | Right-click a terminal in the sidebar; it is shown and Werkbank comes forward when it finishes |
| Show all terminals | The grid button at the top of the sidebar |
| Move a pane | Drag its title onto the left, right, top or bottom edge of another pane; onto its middle swaps the two |
| Copy on select | Settings > Terminal: selecting text with the mouse copies it. Claude Code has its own copy on select (`/config` > Copy on select); turn that off if you only want Werkbank's |
| Resize | Drag the line between panes (hold **Shift** to snap to 25 / 33 / 50 / 67 / 75 %), or the sidebar edge (double-click resets it) |
| Hide a pane (it keeps running) | **×** in its name bar |
| Stop and remove a terminal | **×** in the sidebar (click twice while it is running) |
| Select several terminals | Like Explorer: **Ctrl+click** toggles one, **Shift+click** selects a range, **Ctrl+Shift+click** adds a range, **Ctrl+A** selects all. The bar that appears shows them side by side or stops them all (**Delete** stops them at once, **Ctrl+Z** brings them back); **Esc** clears |
| Close all terminals of a group | Trash button on the group row (click twice; undo brings them back) |
| Rename a terminal or group | Double-click its name |
| Lock a group (it and its terminals cannot be removed) | Lock button on the group row |
| Get notified | Settings > Notifications: a Windows notification naming the terminal (click it to go there, also when Werkbank was closed meanwhile), a count on the taskbar button, a blinking terminal + taskbar flash when a terminal you are not looking at rings its bell or Claude finishes, and a chime when Werkbank is not in front |
| Color a group or a terminal | Right-click it in the sidebar (a terminal's own color wins over its group's) |
| Show / hide the sidebar | Button next to New group, or **Ctrl+Shift+B**; Settings: always, mini (a narrow rail with the terminals' icons) or auto-hide (slides in at the left edge) |
| Undo the last change | Undo button at the top of the sidebar, or **Ctrl+Z** outside a terminal (30 steps) |
| Switch | **Ctrl+1…9**, **Ctrl+Tab** |
| Go to a terminal by typing | **Ctrl+Shift+P**: part of its name, its topic or its group, then Enter |
| Move between panes | **Alt+arrow keys** (with a single pane the terminal gets them) |
| Maximize a pane / back to the split | **Ctrl+Shift+Enter**, or the button in its name bar |
| New terminal like this one | **Ctrl+Shift+D**: same profile and folder, next to it |
| Rename the focused terminal | **F2** |
| Werkbank to the front from anywhere | **Win+Ctrl+W** (again: minimize) |
| Terminal font size | **Ctrl+=** / **Ctrl+-** / **Ctrl+0** |
| Interface size (sidebar, title bar, menus, settings) | **Ctrl+Shift+=** / **Ctrl+Shift+-** / **Ctrl+Shift+0**, or Settings (90–150%) |
| Full screen | **F11**, or the button in the title bar; **Esc** leaves it when you are not typing in a terminal (there Esc belongs to the program, e.g. to stop Claude). In full screen, move the mouse to the top edge for the title bar |
| Fold a group | Click its row |
| Start every terminal when Werkbank starts | Settings > Startup > All terminals (default: only the ones in the window, the rest when you open them) |
| Copy / paste | **Ctrl+C** with a selection / **Ctrl+V**, or right-click: pastes, or copies a selection (like Windows Terminal); a program that reads the mouse, like Claude Code, gets the right-click and pastes itself |
| Terminal menu | **Shift** + right-click in the terminal: copy, paste, find, split, hide |
| Find in a terminal | **Ctrl+Shift+F**: Enter = next, Shift+Enter = previous, Esc closes |
| Open a link | **Ctrl+click** it |
| Open a file at a line | **Ctrl+click** `path:line` in a terminal (also `path(line,col)` and Python's `"path", line n`): it opens in the editor set under Settings > Terminal, else VS Code or Notepad++ when installed, else Notepad (a linked script or program is never run, and network paths are not opened) |
| Paste a file path | Drop the file from Explorer onto the terminal (e.g. a screenshot for Claude) |

Dot colors: green means running, blue means new output, red means exited (press Enter to restart).

## Control it from a terminal

Programs running inside a Werkbank terminal (for example Claude Code) can manage Werkbank with the `werkbank` command:

```sh
werkbank list                                   # groups and terminals with their status
werkbank open --profile "Claude Code" --group Research --name "Claude 4"   # starts in the background
werkbank open --group Research/Papers                  # a group inside a group; made when missing
werkbank open --profile PowerShell --split right   # or --show: put it in the window
werkbank close "Claude 4"                       # by name or id (not in a locked group)
werkbank close                                  # the terminal it runs in, also in a locked group (undo: Ctrl+Z)
werkbank send "Claude 4" "run the tests and fix what fails"   # types it in and presses Enter
werkbank send "Claude 4" "draft text" --no-enter                # only types it
werkbank open --profile "Claude Code" --name Reviewer --prompt "review the open PR"   # new terminal with a task
```

`send` and `--prompt` wait until the program in that terminal is ready (a stopped one is started first) and only type text: control characters and escape codes are dropped, so they cannot press other keys. There is no confirmation: a program in one terminal can give another one work.

Ask an AI in a terminal to end the conversation ("close the ticket and the conversation") and it runs `werkbank close`
as its last step: its terminal goes, also in a locked group. Instructions for that are in `~/.claude/CLAUDE.md` (Claude
Code) and `~/.codex/AGENTS.md` (Codex).

Werkbank listens on 127.0.0.1 only and requires a token that it gives to its own terminals (`WERKBANK_ADDR`,
`WERKBANK_TOKEN`; its folder is put on their `PATH`), so other programs on the PC cannot use it. Changes made this
way can be undone with Ctrl+Z like any other.

## Configuration

Everything lives in `%APPDATA%\nl.dlabs.werkbank\`:

- `profiles.json` holds the terminals you can open. It is written with defaults on first run, and you can edit it freely
  (Werkbank reads it again when it gets the focus, when Settings opens and on `werkbank open`; no restart needed):

  ```json
  [
    { "name": "Claude Code", "command": ["%USERPROFILE%\.local\bin\claude.exe"], "cwd": "%USERPROFILE%",
      "new": ["--session-id", "{id}"], "resume": ["--resume", "{id}"], "prestart": true },
    { "name": "PowerShell", "command": ["powershell.exe", "-NoLogo"] },
    { "name": "Server", "command": ["ssh.exe", "user@example.com"] }
  ]
  ```

  `command` is an argv array, and `%VAR%` is expanded. `cwd` is optional. `new` and `resume` are optional extra arguments for programs that can resume a session; `{id}` is replaced with the pane's id. `default: true` marks the profile that a plain click on **+** opens (otherwise the first). `icon` sets the icon: an image (.png/.ico/.svg/.jpg) or another .exe to take it from; programs without an icon get a letter badge. `prestart` keeps one session of that profile warm in the background, so a slow-starting CLI (Claude Code with many hooks and plugins) opens instantly.
- `layout.json` holds your groups, splits and settings. The app writes it, and an unreadable file is kept as `layout.json.bad`.
- `screens/` holds the last screen of each non-resumable terminal.
- `logs/werkbank.log` notes errors, terminals that stopped and `werkbank` commands (Settings > About opens it).
  At 1 MB it moves to `werkbank.old.log`.

## Install

Copy `werkbank.exe` anywhere and run it. It needs WebView2, which comes with Windows 11.

**Updating:** Windows lets you rename a running exe, so rename the current one to `werkbank.old.exe`, put the new
`werkbank.exe` in its place and restart Werkbank when it suits you. Your groups, splits and settings stay (they are in
`%APPDATA%`), Claude panes resume their conversation and the programs in the terminals stop with the old Werkbank.

**Something wrong?** Settings > About opens the log (`logs\werkbank.log`). `werkbank.exe --selftest` runs every check
against that exe in a throwaway folder, next to a running Werkbank, and prints one PASS/FAIL line per check.

## Build

Werkbank is built with Tauri 2 (Rust): every terminal runs in a ConPTY via `portable-pty`, and xterm.js renders it. The Windows `.exe` is cross-compiled from Linux in a container, so no Windows build machine is needed:

```sh
docker build -t werkbank-build -f build/Dockerfile build
docker run --rm -v "$PWD":/src -v werkbank-cargo:/usr/local/cargo/registry -v werkbank-xwin:/root/.cache werkbank-build ./build.sh
# -> src-tauri/target/x86_64-pc-windows-msvc/release/werkbank.exe
```

`build.sh` stops at the first failing check: the UI unit tests (`node ui/*.test.js`), `tsc` in strict mode over the UI
scripts, ESLint (including undefined names), `cargo fmt --check`, clippy with warnings as errors, and the native Rust
tests. It also builds `werkbank-tests.exe` with the Rust tests that need Windows. On Windows, run that and
`werkbank.exe --selftest` before using a new build; both exit 0 when everything passed. How the code is organized and
the rules for changing it are in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE). The bundled fonts are under the SIL Open Font License, and xterm.js is under MIT.

The terminal color schemes in `ui/schemes.js` each belong to their original author and project; their licenses and
credits are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
