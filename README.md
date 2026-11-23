# Werkbank

A terminal workspace for Windows, built for running several AI coding agents and shells side by side.

- **Groups** in a resizable sidebar, with terminals underneath them.
- **Splits**: divide the window horizontally and vertically, and drag the dividers to resize.
- A **translucent name bar** on every pane, with split buttons and ×.
- **Activity dots** show which terminal has new output while you were looking elsewhere.
- **Continues where you left off**: groups, splits and window size come back, Claude Code panes resume their own conversation, and other terminals show their last screen.
- **Settings panel** that slides in from the right over the terminals, so you see a change on them right away (Esc or a click next to it closes it), with separate app themes (Graphite, Midnight, Espresso, Forest, Light) and 14 popular terminal color schemes (5 dark, 4 medium, 5 light), interface size, accent color, the five most popular coding fonts (Cascadia Code, JetBrains Mono, Fira Code, Source Code Pro, Consolas), font size (the number next to the slider is drawn at the size the terminals get) and cursor style.
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
| Group menu | Right-click a group: color, new terminal (or pick a profile / several), new group inside, show the whole group, rename, lock, profile and folder, close all its terminals, delete the group with its subgroups and terminals (running ones: click twice; **Ctrl+Z** brings it all back) |
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
| Select several terminals | Like Explorer: **Ctrl+click** toggles one, **Shift+click** selects a range, **Ctrl+Shift+click** adds a range, **Ctrl+A** selects all. The bar that appears shows them side by side or stops them all (**Delete** stops them at once; with terminals of a locked group in it press **Delete** twice and those go too; **Ctrl+Z** brings them back); **Esc** clears |
| Close all terminals of a group | Trash button on the group row (click twice; undo brings them back) |
| Rename a terminal or group | Double-click its name |
| Lock a group (its terminals cannot be removed, except by selecting them and pressing Delete twice) | Lock button on the group row |
| Get notified | Settings > Notifications: a Windows notification naming the terminal (click it to go there, also when Werkbank was closed meanwhile), a count on the taskbar button, a blinking terminal + taskbar flash when a terminal you are not looking at rings its bell or Claude finishes, and a chime when Werkbank is not in front |
| Color a group or a terminal | Right-click it in the sidebar (a terminal's own color wins over its group's). The color glows over the whole group and its subgroups; a subgroup with a color of its own keeps the top group's color in its indent |
| Show / hide the sidebar | Button next to New group, or **Ctrl+Shift+B**; Settings: always, mini (a narrow rail with the terminals' icons) or auto-hide (slides in at the left edge) |
| Undo the last change | Undo button at the top of the sidebar, or **Ctrl+Z** outside a terminal (30 steps) |
| Switch | **Ctrl+1…9**; **Ctrl+Tab** works like Alt+Tab: to the terminal you used before, hold Ctrl and press Tab again to go further back (**Ctrl+Shift+Tab**: forward again) |
| Go to a terminal by typing | **Ctrl+Shift+P**: part of its name, its topic, its label or its group, then Enter |
| Find the conversation where something was said | **Ctrl+Shift+P** and type three characters or more: under the terminals found by name it lists the Claude terminals (asleep ones too) whose conversation mentions it, with the place. It looks at what you and Claude said, not at tool output, in any case |
| Label a terminal | A program sets it: `werkbank label "#1072"` puts a short label (24 characters) next to the name of the terminal it runs in, e.g. a ticket number; `werkbank label --clear` takes it off. Ctrl+Z leaves labels alone |
| Be told when you are away | Settings > Notifications > When you are away, run a command (off by default): a program with its arguments that Werkbank starts once when a Claude terminal has finished, you have not looked at it for the set minutes (default 10) and the PC had no keyboard or mouse input that long. The terminal goes to it in `WERKBANK_AWAY_TERMINAL`, `WERKBANK_AWAY_GROUP`, `WERKBANK_AWAY_ID` and `WERKBANK_AWAY_MINUTES`. Only Claude terminals count. The two names are cut down to letters, digits, spaces and `._-` (64 characters), but they still come from the programs in the terminals: use them as data, never inside a command line (`cmd /c ... %WERKBANK_AWAY_TERMINAL%`, `Invoke-Expression`). Needs Flash on (that is what keeps a finished terminal amber) |
| Move between panes | **Alt+arrow keys** (with a single pane the terminal gets them) |
| Maximize a pane / back to the split | **Ctrl+Shift+Enter**, or the button in its name bar |
| New terminal like this one | **Ctrl+Shift+D**: same profile and folder, next to it |
| Rename the focused terminal | **F2** |
| Werkbank to the front from anywhere | **Win+Ctrl+W** (again: minimize) |
| Terminal font size | **Ctrl+=** / **Ctrl+-** / **Ctrl+0** |
| Interface size (sidebar, title bar, menus, settings) | **Ctrl+Shift+=** / **Ctrl+Shift+-** / **Ctrl+Shift+0**, or Settings (90–150%) |
| Full screen | **F11**, or the button in the title bar; **Esc** leaves it when you are not typing in a terminal (there Esc belongs to the program, e.g. to stop Claude). In full screen, move the mouse to the top edge for the title bar |
| Fold a group | Click its row |
| Start every terminal when Werkbank starts | Settings > Startup and memory > All terminals (default: only the ones in the window, the rest when you open them) |
| See the memory | The sidebar footer shows what Werkbank uses with every program in its terminals (amber: over its budget); hover a terminal for its own share. The chip button next to it opens Settings > Memory: every terminal by what it uses, with Sleep now. Task Manager lists those programs separately, not under Werkbank |
| Free memory | A Claude terminal out of view that waits for you falls asleep: its program (with its MCP servers) stops, and showing the terminal continues the conversation. That happens after an hour of waiting, or sooner (after 10 minutes) when Werkbank uses more than its budget (default 25% of the computer's memory): the one that waited longest first. Text typed but not sent, a command still running in it, or Keep awake (right-click it) keep a terminal awake. Asleep terminals stay asleep when Werkbank restarts. Settings > Memory sets the time and the budget; right-click a terminal or group to put it to sleep now |
| Copy / paste | **Ctrl+C** with a selection / **Ctrl+V**, or right-click: pastes, or copies a selection (like Windows Terminal); a program that reads the mouse, like Claude Code, gets the right-click and pastes itself |
| Terminal menu | **Shift** + right-click in the terminal: copy, paste, find, split, hide |
| Find in a terminal | **Ctrl+Shift+F**: Enter = next, Shift+Enter = previous, Esc closes |
| Open a link | **Ctrl+click** it |
| Open a file at a line | **Ctrl+click** `path:line` in a terminal (also `path(line,col)` and Python's `"path", line n`): it opens in the editor set under Settings > Terminal, else VS Code or Notepad++ when installed, else Notepad (a linked script or program is never run, and network paths are not opened) |
| Paste a file path | Drop the file from Explorer onto the terminal (e.g. a screenshot for Claude) |

Dot colors: green means running, blue means new output, red means exited (press Enter to restart). Claude terminals
show more: a turning green ring while Claude works, a green check when it is not working (finished, or waiting for
you), and amber when it just finished and you have not looked at it yet. A grey moon: asleep.

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
werkbank wait Reviewer --timeout 900            # blocks until it is done with that task (default 600 s)
werkbank read Reviewer                          # its last answer (Claude), or the end of its screen (--lines N)
werkbank search "invoice numbering"             # which Claude terminals talked about it, with the place
werkbank label "#1072 · waiting"                # a label on the terminal it runs in (--terminal X: another one)
werkbank label --clear
```

`send` and `--prompt` wait until the program in that terminal is ready (a stopped one is started first) and only type text: control characters and escape codes are dropped, so they cannot press other keys. There is no confirmation: a program in one terminal can give another one work.

### Hand work over and get the answer back

`send`, `wait`, `read` in that order give the answer to *that* prompt: `send` marks the terminal before it types, and
`wait` then only counts it as done after it started on what was sent and finished (a Claude that was done before
still shows "done" right after `send`; that does not count).

- A Claude terminal is done when it stops reporting work (the check in the sidebar) for two seconds. That is also
  the case when it asks you something. An asleep terminal is done; `send` wakes it first.
- Another program (a shell) is done when it has printed nothing for five seconds, so a command that is silent
  longer than that looks done too early.
- `read` on a Claude terminal prints Claude's last text message after the last prompt, from the conversation file
  Claude Code saves (no tool calls). While that prompt has no answer yet it prints nothing and fails, instead of
  giving an older answer. On other terminals it prints the last 40 lines of the screen.
- Look at the exit code of `wait` before you `read`: after 4 the prompt may never have arrived, and the last answer
  in the conversation then belongs to the prompt before it.
- `read` and `search` follow the conversation saved under the terminal's id. A conversation Claude Code continues
  in a new file (after `/clear`) is not followed.
- Claude Code stops a command of its own after two minutes unless it is given a longer timeout, and `wait` waits
  ten: a Claude that waits for another one passes a timeout to its tool, or repeats shorter waits
  (`werkbank wait X --timeout 100` until it is not 1).

| `wait` exits with | Meaning |
|---|---|
| 0 | done: waiting for you (or asleep, or a shell that went quiet) |
| 1 | still working when the timeout passed (`--timeout 0` only looks) |
| 2 | its program stopped, the terminal was closed meanwhile or never started, or `send` could not type |
| 3 | no terminal with that name or id |
| 4 | what was sent started no work within 15 seconds: a slash command, or the prompt did not arrive |
| 5 | Werkbank could not be asked (not inside a terminal, wrong arguments) |

Git Bash (where Claude Code runs its commands) and scripts wait for `werkbank`. At the prompt of cmd and PowerShell
they do not, because `werkbank.exe` is a window program: use `start /wait werkbank wait X` in cmd and
`werkbank wait X | Out-Host` in PowerShell.

**Until it passes.** A loop that keeps giving a terminal the output of a check until the check passes, at most 20
rounds, and stops when the terminal does not finish:

```sh
for round in $(seq 20); do
  out=$(npm test 2>&1) && break                 # the gate: stop when it passes
  werkbank send Fixer -- "The tests still fail. Fix them. Output: $out" || break
  werkbank wait Fixer --timeout 1800 || break   # not done (see the exit codes): stop
done
```

```powershell
foreach ($round in 1..20) {
  $out = npm test 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { break }            # the gate: stop when it passes
  werkbank send Fixer -- "The tests still fail. Fix them. Output: $out" | Out-Host
  werkbank wait Fixer --timeout 1800 | Out-Host # the pipe makes PowerShell wait for it
  if ($LASTEXITCODE -ne 0) { break }            # not done (see the exit codes): stop
}
```

The `--` matters here: after it every word is text. The output of a check can hold anything, and Windows
PowerShell 5 splits an argument at the double quotes inside it (PowerShell 7 does not), so without `--` a word like
`--no-enter` in that output would count as an option. Options of other commands (`--name`, `--profile`, ...) are
text in `send`, `label` and `search` anyway. `send` types at most 20,000 characters.

Ask an AI in a terminal to end the conversation ("close the ticket and the conversation") and it runs `werkbank close`
as its last step: its terminal goes, also in a locked group. Instructions for that are in `~/.claude/CLAUDE.md` (Claude
Code) and `~/.codex/AGENTS.md` (Codex).

Werkbank listens on 127.0.0.1 only and requires a token that it gives to its own terminals (`WERKBANK_ADDR`,
`WERKBANK_TOKEN`; its folder is put on their `PATH`), so other programs on the PC cannot use it. Changes made this
way can be undone with Ctrl+Z like any other.

Every program in a Werkbank terminal has that token. So like `send` lets it type into any other terminal, `read`
and `search` let it read the screen of any other terminal and the Claude conversations of all of them. That is by
design (the same user, the same PC) and worth knowing before you run something you do not trust in a terminal.
What `read` and `search` print is text only: control characters and escape codes are taken out.

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
- `logs/werkbank.log` notes errors, terminals that stopped and `werkbank` commands (Settings > About opens it); never
  what was sent, read or searched for, only the names of the terminals.
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
tests (also those of `transcript.rs`, through the small package in `src-tauri/native-tests`). It also builds `werkbank-tests.exe` with the Rust tests that need Windows. On Windows, run that and
`werkbank.exe --selftest` before using a new build; both exit 0 when everything passed. How the code is organized and
the rules for changing it are in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE). The bundled fonts are under the SIL Open Font License, and xterm.js is under MIT.

The terminal color schemes in `ui/schemes.js` each belong to their original author and project; their licenses and
credits are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
