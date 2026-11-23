// Types for the UI scripts, checked by `tsc` (tsconfig.json, build.sh); the browser never loads this file.
// The scripts are classic scripts sharing one global scope, so everything here is global.

/** A program Werkbank can start (profiles.json, user-editable). */
interface Profile {
  name: string;
  command: string[];
  /** extra arguments for a fresh start; `{id}` becomes the terminal id */
  new?: string[];
  /** extra arguments to continue its own conversation (Claude: `--resume {id}`) */
  resume?: string[];
  cwd?: string;
  icon?: string;
  default?: boolean;
  /** keep one warm session running so a new terminal opens at once */
  prestart?: boolean;
}

/** A terminal as saved in layout.json. */
interface Session {
  id: string;
  name: string;
  profile: string;
  cwd?: string;
  color?: string;
  /** named by hand: its program's title does not rename it */
  custom?: boolean;
  /** the last title its program set (Claude Code: the conversation topic), its name while no program runs */
  title?: string;
  /** its program has a conversation of its own to resume */
  resumable?: boolean;
  /** bring Werkbank to the front when it is done */
  front?: boolean;
  /** asleep: its program was stopped to free memory and continues its conversation when shown (memory.js) */
  asleep?: boolean;
  /** never put to sleep (a loop or scheduled task runs in it that shows no process) */
  awake?: boolean;
  /** its label, set with `werkbank label` (e.g. a ticket number): shown next to its name; undo leaves it alone */
  tag?: string;
}

interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  sessions: Session[];
  /** the group this one sits in (groups.js); missing = top level */
  parent?: string;
  color?: string;
  locked?: boolean;
  /** profile and folder for new terminals in this group */
  profile?: string;
  cwd?: string;
}

/** The split layout in the window: a pane, or two halves (row = side by side, col = stacked). */
type TreeNode = { id: string } | { dir: 'row' | 'col'; ratio: number; a: TreeNode; b: TreeNode };

/** Where a hidden pane stood, so it comes back to the same place. */
interface Spot {
  sibling: string;
  dir: 'row' | 'col';
  /** it stood before (left of / above) its sibling */
  before: boolean;
  ratio: number;
}

/** layout.json: owned by the UI. */
interface Layout {
  groups: Group[];
  tree: TreeNode | null;
  active: string | null;
  theme: string;
  uiTheme: string;
  accent: string | null;
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  uiZoom?: number;
  sideWidth?: number;
  sideMode?: 'open' | 'collapsed' | 'auto';
  startup?: 'shown' | 'all';
  copySelect?: boolean;
  /** minutes a quiet, resumable terminal out of view runs before it sleeps (its program stops); 0 = never, unset = 60 */
  sleepAfter?: number;
  /** percent of the computer's memory Werkbank may use before waiting terminals sleep; 0 = no budget, unset = 25 */
  memBudget?: number;
  notifySound?: boolean;
  notifyVolume?: number;
  notifyFlash?: boolean;
  notifyToast?: boolean;
  openCount?: number;
  spots?: Record<string, Spot>;
  /** command line that opens a file link; empty = the editor Werkbank finds itself */
  editor?: string;
  /** command line (no shell) started when a finished Claude terminal stays unseen while you are away; empty = off */
  awayCommand?: string;
  /** minutes a terminal waits unseen, and the PC gets no input, before the away command runs; unset = 10 */
  awayAfter?: number;
}

/** Work `werkbank send` gave a terminal, for `werkbank wait` (handoff.js): while it is there, "done" only counts after this work. */
interface Job {
  /** when the text was typed and Enter pressed; unset while the program is still getting ready */
  typedAt?: number;
  /** the program began working after that */
  started?: boolean;
  /** nothing was typed, and why */
  failed?: string;
}

/** What `werkbank wait` looks at (waitVerdict in handoff.js). */
interface WaitInput {
  /** its program reports when it works (Claude Code); others count as done when quiet */
  reports: boolean;
  asleep: boolean;
  starting: boolean;
  running: boolean;
  exited: boolean;
  working?: boolean;
  idleSince?: number;
  lastOutput?: number;
  job?: Job;
}

/** A terminal while Werkbank runs (not saved): its xterm, pane and program state. */
interface Runtime {
  term: import('@xterm/xterm').Terminal;
  fit: import('@xterm/addon-fit').FitAddon;
  ser: import('@xterm/addon-serialize').SerializeAddon;
  search: import('@xterm/addon-search').SearchAddon;
  pane: HTMLDivElement;
  opened: boolean;
  starting?: boolean;
  running: boolean;
  exited: boolean;
  unread: boolean;
  /** needs your attention (bell, Claude done) */
  attn?: boolean;
  /** since when, and the wait the away command already ran for (attention.js) */
  attnAt?: number;
  awayFor?: number;
  /** what `werkbank send` typed last, until the work it started has ended */
  job?: Job;
  restored?: boolean;
  resuming?: boolean;
  startedAt?: number;
  /** when start last switched between resume and fresh, so it does not loop */
  flippedAt?: number;
  /** the current start; an exit of an older one is ignored */
  run?: { ended?: () => void };
  /** the program put to sleep, until it has really ended (a resume before that is refused: session in use) */
  dying?: Promise<unknown>;
  /** when it last went quiet (done, waiting for you) and when you last typed in it: how long it has waited */
  idleSince?: number;
  inputAt?: number;
  /** text typed after the last Enter: it would be lost, so the terminal does not sleep */
  draft?: boolean;
  /** bytes its program uses with what that started (memory.rs) */
  mem?: number;
  /** its program runs something it started later (a command in the background): it does not sleep */
  busy?: boolean;
  /** when it was last in view */
  seenAt?: number;
  /** input typed while the program was starting */
  pending?: string[] | null;
  /** the last write to its program; the next one waits for it (writeTo) */
  writes?: Promise<void>;
  lastOutput?: number;
  title?: string;
  firstTitle?: string;
  /** Claude busy: by its progress report, its title, either */
  progress?: boolean;
  spinning?: boolean;
  working?: boolean;
}

/** The Rust commands (src-tauri/src, generate_handler! in main.rs): arguments and result of each. */
interface Commands {
  load: [undefined, { profiles: Profile[]; layout: Layout | null }];
  save_layout: [{ layout: Layout }, void];
  save_screen: [{ id: string; data: string }, void];
  load_screen: [{ id: string }, string | null];
  prune_screens: [{ keep: string[] }, void];
  save_profiles: [{ profiles: Profile[] }, void];
  open_profiles: [undefined, void];
  log: [{ line: string }, void];
  open_log: [undefined, void];
  selftest_exe: [undefined, string | null];
  selftest_done: [{ report: string; passed: boolean }, void];
  to_front: [undefined, void];
  program_icon: [{ program: string }, [number, number, number[]] | null];
  icon_file: [{ path: string }, number[] | null];
  open_url: [{ url: string }, void];
  open_file: [{ path: string; line: number | null; col: number | null; cwd: string | null; editor: string | null }, void];
  notify: [{ id: string; title: string; body: string }, void];
  api_reply: [{ id: number; reply: unknown }, void];
  quit: [undefined, void];
  spawn: [{
    id: string; command: string[]; cwd: string | null; cols: number; rows: number;
    onData: import('@tauri-apps/api/core').Channel<ArrayBuffer>;
    onExit: import('@tauri-apps/api/core').Channel<number | null>;
  }, void];
  has_conversation: [{ id: string }, boolean];
  conversation_title: [{ id: string }, string | null];
  conversation_answer: [{ id: string }, string | null];
  search_conversations: [{ ids: string[]; query: string; replaces: boolean }, [string, string][]];
  idle_seconds: [undefined, number];
  away_run: [{ command: string[]; terminal: string; group: string; id: string; minutes: number }, void];
  launch_target: [undefined, string | null];
  write: [{ id: string; data: string }, void];
  resize: [{ id: string; cols: number; rows: number }, void];
  kill: [{ id: string }, void];
  memory: [undefined, { total: number; ram: number; terminals: Record<string, { bytes: number; busy: boolean }> }];
}

/** Events from Rust (app.emit) and their payloads. */
interface Events {
  'show-terminal': string;
  'before-quit': null;
  'api-request': { id: number; cmd: string; args: Record<string, unknown> };
}

interface Window {
  __TAURI__: {
    core: typeof import('@tauri-apps/api/core');
    event: typeof import('@tauri-apps/api/event');
    window: typeof import('@tauri-apps/api/window');
    webview: typeof import('@tauri-apps/api/webview');
    app: typeof import('@tauri-apps/api/app');
    dialog: typeof import('@tauri-apps/plugin-dialog');
    clipboardManager: typeof import('@tauri-apps/plugin-clipboard-manager');
  };
}

// xterm and its addons, loaded as plain scripts from ui/vendor
declare const Terminal: typeof import('@xterm/xterm').Terminal;
declare const FitAddon: typeof import('@xterm/addon-fit');
declare const CanvasAddon: typeof import('@xterm/addon-canvas');
declare const SerializeAddon: typeof import('@xterm/addon-serialize');
declare const SearchAddon: typeof import('@xterm/addon-search');
declare const WebLinksAddon: typeof import('@xterm/addon-web-links');
