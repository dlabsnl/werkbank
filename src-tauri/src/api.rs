//! Local control API, so programs running inside a Werkbank terminal (e.g. Claude Code) can list, open and close
//! terminals, type a task into one, wait for it and read its answer with the `werkbank` command. It listens on 127.0.0.1 only, and every request must carry the token
//! that Werkbank hands to its own terminals (WERKBANK_TOKEN), so other programs on the PC cannot use it.
//! Protocol: one JSON line per request {"token","cmd","args"}, one JSON line back {"ok","result"|"error"}.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    mpsc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct Api {
    pub addr: String,
    pub token: String,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next: AtomicU64,
}

/// Connections served at once (each can wait `UI_WAIT` for the UI); more are closed right away, so a program
/// cannot make Werkbank start threads without end.
const MAX_CONNECTIONS: usize = 16;
static OPEN: AtomicUsize = AtomicUsize::new(0);
/// How long the UI gets to answer; the CLI waits longer (15 s), so it always gets this answer.
const UI_WAIT: Duration = Duration::from_secs(10);
const REFUSED: &str = "wrong or missing token";

/// 256-bit token from the OS's cryptographic random generator, as 64 hex characters.
fn token() -> Option<String> {
    let mut b = [0u8; 32];
    random(&mut b).then(|| b.iter().map(|x| format!("{x:02x}")).collect())
}

#[cfg(windows)]
fn random(buf: &mut [u8]) -> bool {
    // raw-dylib: no import library needed (bcrypt.dll is part of every Windows)
    #[link(name = "bcrypt", kind = "raw-dylib")]
    extern "system" {
        fn BCryptGenRandom(alg: *mut std::ffi::c_void, buf: *mut u8, len: u32, flags: u32) -> i32;
    }
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 2;
    let Ok(len) = u32::try_from(buf.len()) else {
        return false;
    };
    // SAFETY: `buf` is a live, writable buffer of exactly `len` bytes for the whole call, and with
    // BCRYPT_USE_SYSTEM_PREFERRED_RNG the algorithm handle must be null.
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            len,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    status == 0
}

#[cfg(not(windows))]
fn random(buf: &mut [u8]) -> bool {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(buf))
        .is_ok()
}

/// Binds the listener and starts accepting; the UI answers requests through `api_reply`.
pub fn start(app: &AppHandle) {
    let listener = TcpListener::bind("127.0.0.1:0");
    let addr = listener.as_ref().ok().and_then(|l| l.local_addr().ok());
    let (Ok(listener), Some(addr), Some(token)) = (listener, addr, token()) else {
        crate::store::write_log(
            app,
            "werkbank command unavailable: cannot listen on 127.0.0.1 or get a random token",
        );
        return;
    };
    app.manage(Api {
        addr: addr.to_string(),
        token,
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
    });
    let app = app.clone();
    std::thread::spawn(move || loop {
        let Ok((stream, _)) = listener.accept() else {
            // e.g. out of sockets: wait instead of spinning on the error
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let Some(slot) = Slot::take() else {
            continue; // dropping the stream closes it
        };
        let app = app.clone();
        let _ = std::thread::Builder::new().spawn(move || {
            let _slot = slot;
            handle(&app, stream);
        });
    });
}

/// One of the `MAX_CONNECTIONS`; given back when dropped, also when its thread panics or cannot start.
struct Slot;
impl Slot {
    fn take() -> Option<Slot> {
        if OPEN.fetch_add(1, Ordering::SeqCst) < MAX_CONNECTIONS {
            Some(Slot)
        } else {
            OPEN.fetch_sub(1, Ordering::SeqCst);
            None
        }
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        OPEN.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A stream whose reads all end by one moment, so a client sending a byte now and then cannot keep its thread.
struct Deadline(TcpStream, Instant);
impl Read for Deadline {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let left = self.1.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(std::io::ErrorKind::TimedOut.into());
        }
        self.0.set_read_timeout(Some(left))?;
        self.0.read(buf)
    }
}

/// Compares in constant time, so the answer time does not reveal how much of a guessed token was right.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |d, (x, y)| d | (x ^ y)) == 0
}

/// The command and its arguments (always an object) from a request line whose token matches, or the error to answer.
fn parse(line: &str, token: &str) -> Result<(String, Value), String> {
    let req: Value = serde_json::from_str(line).map_err(|e| format!("bad request: {e}"))?;
    if !same(req["token"].as_str().unwrap_or_default(), token) {
        return Err(REFUSED.into());
    }
    let Some(cmd) = req["cmd"].as_str() else {
        return Err("bad request: cmd must be a string".into());
    };
    match &req["args"] {
        Value::Null => Ok((cmd.into(), json!({}))),
        args @ Value::Object(_) => Ok((cmd.into(), args.clone())),
        _ => Err("bad request: args must be an object".into()),
    }
}

fn handle(app: &AppHandle, stream: TcpStream) {
    let Ok(mut out) = stream.try_clone() else {
        return;
    };
    let _ = out.set_write_timeout(Some(Duration::from_secs(5)));
    // any local program can connect before the token is checked: one line of at most 1 MB, within 5 seconds in all
    let mut line = String::new();
    let end = Instant::now() + Duration::from_secs(5);
    if BufReader::new(Deadline(stream, end).take(1 << 20))
        .read_line(&mut line)
        .is_err()
    {
        return;
    }
    let api = app.state::<Api>();
    let reply = match parse(&line, &api.token) {
        Ok((cmd, args)) => ask_ui(app, &api, &cmd, args),
        Err(e) => {
            if e == REFUSED {
                crate::store::write_log(app, "werkbank command refused: wrong or missing token");
            }
            json!({ "ok": false, "error": e })
        }
    };
    let _ = writeln!(out, "{reply}");
}

/// Hands a request to the UI (ui/api.js) and waits for its `api_reply`.
fn ask_ui(app: &AppHandle, api: &Api, cmd: &str, args: Value) -> Value {
    let id = api.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    api.pending.lock().unwrap().insert(id, tx);
    let reply = app
        .emit("api-request", json!({ "id": id, "cmd": cmd, "args": args }))
        .ok()
        .and_then(|()| rx.recv_timeout(UI_WAIT).ok());
    api.pending.lock().unwrap().remove(&id);
    reply.unwrap_or_else(|| json!({ "ok": false, "error": "Werkbank did not answer" }))
}

#[tauri::command]
pub fn api_reply(api: State<Api>, id: u64, reply: Value) {
    if let Some(tx) = api.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

/// Git Bash (where Claude Code runs its commands on Windows) turns an argument that starts with / into a Windows
/// path: `werkbank send X /model opus` arrives as "C:/Program Files/Git/model". Turned back here, so slash
/// commands reach the terminal as typed.
fn unmangle(arg: &str) -> String {
    if std::env::var_os("MSYSTEM").is_none() {
        return arg.to_string();
    }
    unmangle_in(arg, std::env::var("EXEPATH").ok().as_deref())
}

/// `unmangle` with Git's folder as Git Bash gives it in EXEPATH (None: the default install folder).
fn unmangle_in(arg: &str, exepath: Option<&str>) -> String {
    let root = exepath.map_or_else(
        || "C:/Program Files/Git".to_string(),
        |p| {
            let p = p.replace('\\', "/");
            p.trim_end_matches('/').trim_end_matches("/bin").to_string()
        },
    );
    // Windows paths ignore case
    match arg.split_at_checked(root.len()) {
        Some((head, rest)) if head.eq_ignore_ascii_case(&root) && rest.starts_with('/') => {
            rest.to_string()
        }
        _ => arg.to_string(),
    }
}

const HELP: &str = "werkbank - control Werkbank from inside one of its terminals

  werkbank list                                  groups and terminals with their status and label
  werkbank open [--profile P] [--group G] [--name N] [--show | --split right|down]
                                                 open a terminal (in the background unless --show / --split)
  werkbank close [<name or id>]                  stop and remove a terminal (not in a locked group); without a
                                                 name: the terminal it runs in, also in a locked group (e.g. a
                                                 Claude asked to end its conversation)
  werkbank send <name or id> <text> [--no-enter] type text into a terminal and press Enter (once its program is
                                                 ready; a stopped terminal is started first)
  werkbank open ... --prompt <text>              open a terminal and give it a first task the same way
  werkbank wait <name or id> [--timeout <s>]     wait until that terminal is done with its work (default 600 s;
                                                 0 = only look) and print its state. After send it waits for the
                                                 answer to what was sent. Exit code: 0 done, waiting for you
                                                 1 still working at the timeout   2 its program stopped, or the
                                                 terminal was closed or never started   3 no such terminal
                                                 4 what was sent did not start any work   5 could not ask Werkbank
  werkbank read [<name or id>] [--lines N]       a Claude terminal: its last answer (text only, from its saved
                                                 conversation); another terminal: the last N lines of its screen
                                                 (40). Without a name: the terminal it runs in
  werkbank search <text>                         terminals whose Claude conversation mentions the text (what you
                                                 and Claude said, any case, also asleep ones): name, id, the place
  werkbank label <text> [--terminal <name or id>]  a short label next to a terminal's name (e.g. a ticket number);
  werkbank label --clear [--terminal ...]        without --terminal: the terminal it runs in

Each option only counts for its own command; in the text of send, label and search it is text. After -- every
word is text (werkbank send X -- \"$output\": safe when a shell splits the text into several words).
read and search print text only: control characters and escape codes from a screen or conversation are dropped.
send only types text: control characters and escape codes are dropped. Opening and closing can be undone in
Werkbank with Ctrl+Z. cmd and PowerShell do not wait for werkbank.exe at their prompt: there use
`start /wait werkbank wait X` (cmd) or `werkbank wait X | Out-Host` (PowerShell); a script or Git Bash waits.";

/// What main.rs starts the command line client for, also outside a Werkbank terminal (it then says so).
pub const COMMANDS: &[&str] = &[
    "list", "open", "close", "send", "wait", "read", "search", "label", "help", "--help", "-h",
];

/// The arguments of a command line (`args`: what follows the command) as the UI gets them, or what is wrong with
/// it. `me` is the terminal the command runs in (WERKBANK_TERMINAL).
fn request(
    cmd: &str,
    args: &[String],
    me: Option<&str>,
) -> Result<serde_json::Map<String, Value>, String> {
    let mut opts = serde_json::Map::new();
    let mut text = Vec::new();
    let mut rest = args.iter();
    // every option belongs to one command: in the text of another one the same word is text (a prompt that
    // mentions --name must not send it to another terminal)
    let wordy = matches!(cmd, "send" | "label" | "search");
    let mut literal = false;
    while let Some(a) = rest.next() {
        let key = a.trim_start_matches("--");
        match a.as_str() {
            _ if literal => text.push(unmangle(a)),
            // after `--` everything is text, whatever it looks like
            "--" if wordy => literal = true,
            "--profile" | "--group" | "--name" | "--split" | "--prompt" if cmd == "open" => {
                let v = rest.next().ok_or(format!("{a} needs a value"))?;
                opts.insert(key.into(), json!(unmangle(v)));
            }
            // label: its words are the text, so the terminal is an option there
            "--terminal" if cmd == "label" => {
                let v = rest.next().ok_or(format!("{a} needs a value"))?;
                opts.insert("name".into(), json!(v));
            }
            "--timeout" | "--lines"
                if matches!((cmd, key), ("wait", "timeout") | ("read", "lines")) =>
            {
                let n = rest.next().and_then(|v| v.parse::<u32>().ok());
                opts.insert(
                    key.into(),
                    json!(n.ok_or(format!("{a} needs a whole number"))?),
                );
            }
            "--show" | "--no-enter"
                if matches!((cmd, key), ("open", "show") | ("send", "no-enter")) =>
            {
                opts.insert(key.into(), json!(true));
            }
            "--clear" if cmd == "label" => {
                opts.insert(key.into(), json!(true));
            }
            // the first word names the terminal
            other
                if matches!(cmd, "close" | "send" | "wait" | "read")
                    && !opts.contains_key("name") =>
            {
                opts.insert("name".into(), json!(other));
            }
            // everything after that is the text, so quotes are optional
            other if wordy => text.push(unmangle(other)),
            other => return Err(format!("unknown argument {other} (see: werkbank help)")),
        }
    }
    let text = text.join(" ");
    let named = opts.contains_key("name");
    let mine = |what: &str| {
        me.map(|id| json!(id))
            .ok_or(format!("{cmd} needs {what} outside a Werkbank terminal"))
    };
    match cmd {
        "send" if !named => {
            return Err("send needs a terminal name or id, then the text".into());
        }
        "close" if !named => {
            opts.insert("name".into(), mine("a terminal name or id")?);
            opts.insert("self".into(), json!(true));
        }
        "wait" if !named => {
            return Err("wait needs the name or id of another terminal".into());
        }
        // the program asking runs in it: it would wait for itself until the timeout
        "wait" if me.is_some_and(|id| opts["name"] == json!(id)) => {
            return Err("wait cannot wait for the terminal it runs in".into());
        }
        "read" if !named => {
            opts.insert("name".into(), mine("a terminal name or id")?);
        }
        "label" => {
            let clear = opts.remove("clear").is_some();
            if clear != text.trim().is_empty() {
                return Err("label needs a text, or --clear to take the label off".into());
            }
            if !named {
                opts.insert("name".into(), mine("--terminal <name or id>")?);
            }
        }
        "search" if text.trim().is_empty() => return Err("search needs a text".into()),
        _ => {}
    }
    if matches!(cmd, "send" | "label" | "search") {
        opts.insert("text".into(), json!(text));
    }
    Ok(opts)
}

/// One request to Werkbank and its answer.
fn ask(
    addr: &str,
    token: &str,
    cmd: &str,
    opts: &serde_json::Map<String, Value>,
) -> std::io::Result<Value> {
    let mut s = TcpStream::connect(addr)?;
    s.set_read_timeout(Some(Duration::from_secs(15)))?;
    writeln!(s, "{}", json!({ "token": token, "cmd": cmd, "args": opts }))?;
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line)?;
    serde_json::from_str(&line).map_err(std::io::Error::other)
}

/// `werkbank wait`: asks twice a second (one short request each time: Werkbank answers a request within seconds and
/// serves few at once) until the terminal is done or the timeout has passed. The exit codes are in HELP.
fn wait(addr: &str, token: &str, mut opts: serde_json::Map<String, Value>) -> i32 {
    let timeout = opts
        .remove("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(600);
    let end = Instant::now() + Duration::from_secs(timeout);
    // its name once found: from then on it is asked for by id (a Claude's name changes with its topic)
    let mut found: Option<String> = None;
    // one question that gets no answer (Werkbank busy for a moment) must not end a wait of minutes
    let mut failed = 0;
    loop {
        let r = match ask(addr, token, "wait", &opts) {
            Ok(r) if r["ok"] == json!(true) => r["result"].clone(),
            answer => {
                failed += 1;
                if failed <= WAIT_RETRIES {
                    std::thread::sleep(WAIT_EVERY);
                    continue;
                }
                match answer {
                    Ok(r) => eprintln!("werkbank: {}", r["error"].as_str().unwrap_or("failed")),
                    Err(e) => eprintln!("werkbank: cannot reach Werkbank at {addr}: {e}"),
                }
                return 5;
            }
        };
        failed = 0;
        let text = r["text"].as_str().unwrap_or("?");
        if r["done"] == json!(true) {
            return match (r["code"].as_i64(), &found) {
                // there a moment ago: closed meanwhile (a program that ends itself closes its terminal)
                (Some(3), Some(name)) => {
                    println!("\"{name}\" was closed");
                    2
                }
                (Some(3), None) => {
                    eprintln!("werkbank: {text}");
                    3
                }
                (code, _) => {
                    println!("{text}");
                    code.and_then(|c| i32::try_from(c).ok()).unwrap_or(5)
                }
            };
        }
        if let (None, Some(id), Some(name)) = (&found, r["id"].as_str(), r["name"].as_str()) {
            opts.insert("name".into(), json!(id));
            found = Some(name.into());
        }
        if Instant::now() >= end {
            eprintln!("werkbank: {text} (not done after {timeout} s)");
            return 1;
        }
        std::thread::sleep(WAIT_EVERY);
    }
}

/// `werkbank wait` asks this often, and this many times again when a question got no answer.
const WAIT_EVERY: Duration = Duration::from_millis(500);
const WAIT_RETRIES: u32 = 3;

/// `werkbank <command> ...` run from a terminal inside Werkbank: send the request, print the answer, exit code.
pub fn run_cli(args: &[String]) -> i32 {
    attach_console();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    if matches!(cmd, "help" | "--help" | "-h") {
        println!("{HELP}");
        return 0;
    }
    // for wait, 1 means "still working": anything that keeps it from asking is 5
    let failed = if cmd == "wait" { 5 } else { 1 };
    let (Ok(addr), Ok(token)) = (
        std::env::var("WERKBANK_ADDR"),
        std::env::var("WERKBANK_TOKEN"),
    ) else {
        eprintln!("werkbank: run this inside a Werkbank terminal (WERKBANK_ADDR / WERKBANK_TOKEN are not set)");
        return failed;
    };
    let me = std::env::var("WERKBANK_TERMINAL").ok();
    let opts = match request(cmd, args.get(1..).unwrap_or_default(), me.as_deref()) {
        Ok(opts) => opts,
        Err(e) => {
            eprintln!("werkbank: {e}");
            return failed;
        }
    };
    if cmd == "wait" {
        return wait(&addr, &token, opts);
    }
    match ask(&addr, &token, cmd, &opts) {
        Ok(r) if r["ok"] == json!(true) => {
            print_result(cmd, &r["result"]);
            0
        }
        Ok(r) => {
            eprintln!("werkbank: {}", r["error"].as_str().unwrap_or("failed"));
            1
        }
        Err(e) => {
            eprintln!("werkbank: cannot reach Werkbank at {addr}: {e}");
            1
        }
    }
}

fn print_result(cmd: &str, r: &Value) {
    if cmd == "search" {
        let hits = r.as_array().map(Vec::as_slice).unwrap_or_default();
        if hits.is_empty() {
            eprintln!("werkbank: no conversation mentions it");
        }
        for h in hits {
            let id = h["id"].as_str().unwrap_or("");
            println!(
                "{:<28} {}  {}",
                h["name"].as_str().unwrap_or("?"),
                id.get(..8).unwrap_or(id),
                h["snippet"].as_str().unwrap_or("")
            );
        }
        return;
    }
    if cmd != "list" {
        println!("{}", r.as_str().unwrap_or(&r.to_string()));
        return;
    }
    for g in r.as_array().into_iter().flatten() {
        println!(
            "{}{}",
            g["group"].as_str().unwrap_or("?"),
            if g["locked"] == json!(true) {
                "  (locked)"
            } else {
                ""
            }
        );
        for t in g["terminals"].as_array().into_iter().flatten() {
            let id = t["id"].as_str().unwrap_or("");
            let label = t["label"].as_str().unwrap_or("");
            println!(
                "  {:<28} {:<14} {:<8} {}{}{}",
                t["name"].as_str().unwrap_or("?"),
                t["profile"].as_str().unwrap_or(""),
                t["status"].as_str().unwrap_or(""),
                id.get(..8).unwrap_or(id),
                if t["visible"] == json!(true) {
                    "  (in window)"
                } else {
                    ""
                },
                if label.is_empty() {
                    String::new()
                } else {
                    format!("  [{label}]")
                }
            );
        }
    }
}

/// The exe is a GUI-subsystem program; when run from an interactive console it has no stdout until it attaches
/// to the parent's console (with redirected/piped output, as in Claude Code's shell, the handles already work).
pub fn attach_console() {
    #[cfg(windows)]
    {
        use windows::Win32::System::Console::{
            AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE,
        };
        // SAFETY: GetStdHandle only reads this process's standard handle table; the handle it returns is not used
        // beyond checking it.
        let missing = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }
            .map(|h| h.is_invalid() || h.0.is_null())
            .unwrap_or(true);
        if missing {
            // SAFETY: AttachConsole takes no pointers; it fails harmlessly when there is no parent console or the
            // process already has one.
            let _ = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmangles_git_bash_paths() {
        assert_eq!(unmangle_in("C:/Program Files/Git/model", None), "/model");
        assert_eq!(unmangle_in("c:/program files/git/model", None), "/model");
        assert_eq!(
            unmangle_in("D:/Git/model", Some("D:\\Git\\bin\\")),
            "/model"
        );
        assert_eq!(unmangle_in("D:/Git/model", Some("D:\\Git")), "/model");
        assert_eq!(
            unmangle_in("C:/Program Files/Git", None),
            "C:/Program Files/Git"
        );
        assert_eq!(
            unmangle_in("C:/Program Files/Github/x", None),
            "C:/Program Files/Github/x"
        );
        assert_eq!(unmangle_in("opus", None), "opus");
        assert_eq!(unmangle_in("ééééééééééé", None), "ééééééééééé"); // cut inside a character
    }

    #[test]
    fn command_lines_become_requests() {
        let req = |line: &str, me: Option<&str>| {
            let words: Vec<String> = line.split(' ').map(String::from).collect();
            request(&words[0], &words[1..], me).map(Value::Object)
        };
        let err = |line: &str, me: Option<&str>| req(line, me).unwrap_err();
        // the commands that were there before
        assert_eq!(
            req("send Two echo hi --no-enter", None),
            Ok(json!({ "name": "Two", "text": "echo hi", "no-enter": true }))
        );
        assert!(err("send", None).contains("terminal name"));
        // options of other commands are text here
        assert_eq!(
            req("send Two rerun with --timeout 5 --lines 3 --clear", None),
            Ok(json!({ "name": "Two", "text": "rerun with --timeout 5 --lines 3 --clear" }))
        );
        assert!(err("read Two --timeout 5", None).contains("unknown argument"));
        // and so are the options of open: text that mentions --name does not go to another terminal
        assert_eq!(
            req("send Two a --name Other", None),
            Ok(json!({ "name": "Two", "text": "a --name Other" }))
        );
        assert_eq!(
            req(
                "send Two --profile P --group G --split down --prompt x --show",
                None
            ),
            Ok(
                json!({ "name": "Two", "text": "--profile P --group G --split down --prompt x --show" })
            )
        );
        assert_eq!(
            req("label --name Other --show", Some("abcd")),
            Ok(json!({ "name": "abcd", "text": "--name Other --show" }))
        );
        assert!(err("open --no-enter", None).contains("unknown argument"));
        assert!(err("close Two --show", None).contains("unknown argument"));
        assert!(err("wait Two --name Other", None).contains("unknown argument"));
        // after -- everything is text, also the options of the command itself
        assert_eq!(
            req("send Two -- say --no-enter -- twice", None),
            Ok(json!({ "name": "Two", "text": "say --no-enter -- twice" }))
        );
        assert_eq!(
            req("label -- --clear", Some("abcd")),
            Ok(json!({ "name": "abcd", "text": "--clear" }))
        );
        assert_eq!(
            req("search -- --terminal", None),
            Ok(json!({ "text": "--terminal" }))
        );
        assert!(err("open --", None).contains("unknown argument"));
        assert_eq!(
            req("close", Some("abcd")),
            Ok(json!({ "name": "abcd", "self": true }))
        );
        assert_eq!(req("close Two", Some("abcd")), Ok(json!({ "name": "Two" })));
        assert!(err("close", None).contains("outside a Werkbank terminal"));
        assert_eq!(
            req("open --profile Cmd --show", None),
            Ok(json!({ "profile": "Cmd", "show": true }))
        );
        assert!(err("open stray", None).contains("unknown argument stray"));
        assert!(err("open --name", None).contains("needs a value"));
        // wait: another terminal, the timeout a whole number
        assert_eq!(req("wait Two", Some("abcd")), Ok(json!({ "name": "Two" })));
        assert_eq!(
            req("wait Two --timeout 30", None),
            Ok(json!({ "name": "Two", "timeout": 30 }))
        );
        assert_eq!(
            req("wait --timeout 0 Two", None),
            Ok(json!({ "name": "Two", "timeout": 0 }))
        );
        assert!(err("wait", Some("abcd")).contains("another terminal"));
        assert!(err("wait abcd", Some("abcd")).contains("it runs in"));
        assert!(err("wait Two --timeout soon", None).contains("whole number"));
        assert!(err("wait Two --timeout -1", None).contains("whole number"));
        assert!(err("wait Two --timeout", None).contains("whole number"));
        assert!(err("wait Two Three", None).contains("unknown argument Three"));
        // read: the terminal it runs in unless named
        assert_eq!(req("read", Some("abcd")), Ok(json!({ "name": "abcd" })));
        assert_eq!(
            req("read Two --lines 5", Some("abcd")),
            Ok(json!({ "name": "Two", "lines": 5 }))
        );
        assert!(err("read", None).contains("outside a Werkbank terminal"));
        // search: every word is the text
        assert_eq!(
            req("search the  invoice bug", None),
            Ok(json!({ "text": "the  invoice bug" }))
        );
        assert!(err("search", None).contains("needs a text"));
        // label: the text, on the terminal it runs in or the one named; --clear takes it off
        assert_eq!(
            req("label #1072 waiting", Some("abcd")),
            Ok(json!({ "name": "abcd", "text": "#1072 waiting" }))
        );
        assert_eq!(
            req("label #1072 --terminal Two", Some("abcd")),
            Ok(json!({ "name": "Two", "text": "#1072" }))
        );
        assert_eq!(
            req("label --clear", Some("abcd")),
            Ok(json!({ "name": "abcd", "text": "" }))
        );
        assert_eq!(
            req("label --clear --terminal Two", None),
            Ok(json!({ "name": "Two", "text": "" }))
        );
        assert!(err("label", Some("abcd")).contains("--clear"));
        assert!(err("label x --clear", Some("abcd")).contains("--clear"));
        assert!(err("label x", None).contains("--terminal"));
        // --terminal belongs to label only
        assert!(err("read --terminal Two", Some("abcd")).contains("unknown argument"));
        for c in ["wait", "read", "search", "label"] {
            assert!(COMMANDS.contains(&c));
        }
    }

    /// A stand-in for Werkbank: answers each connection in turn with the next line (None: hangs up without one).
    fn fake_werkbank(answers: Vec<Option<Value>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || {
            for answer in answers {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut line = String::new();
                let _ = BufReader::new(&stream).read_line(&mut line);
                if let Some(a) = answer {
                    let _ = writeln!(stream, "{a}");
                }
            }
        });
        addr
    }

    #[test]
    fn wait_asks_again_when_a_question_gets_no_answer() {
        let name = || serde_json::Map::from_iter([("name".to_string(), json!("Two"))]);
        let done = json!({ "ok": true, "result": { "done": true, "code": 0, "text": "done" } });
        let busy = json!({ "ok": true, "result": { "done": false, "code": 0, "text": "works", "id": "ab", "name": "Two" } });
        let late = json!({ "ok": false, "error": "Werkbank did not answer" });
        // three questions in a row without an answer, then it goes on
        let addr = fake_werkbank(vec![None, Some(late.clone()), None, Some(busy), Some(done)]);
        assert_eq!(wait(&addr, "t", name()), 0);
        // four in a row: it gives up
        let addr = fake_werkbank(vec![None, None, None, Some(late)]);
        assert_eq!(wait(&addr, "t", name()), 5);
    }

    #[test]
    fn compares_tokens() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "ab"));
        assert!(!same("", "a"));
    }

    #[test]
    fn parses_requests() {
        let ok = |line: &str| parse(line, "t");
        assert_eq!(
            ok(r#"{"token":"t","cmd":"list"}"#),
            Ok(("list".into(), json!({})))
        );
        assert_eq!(
            ok(r#"{"token":"t","cmd":"send","args":{"name":"x"}}"#),
            Ok(("send".into(), json!({ "name": "x" })))
        );
        assert_eq!(ok(r#"{"token":"u","cmd":"list"}"#), Err(REFUSED.into()));
        assert_eq!(ok(r#"{"cmd":"list"}"#), Err(REFUSED.into()));
        assert_eq!(ok("5"), Err(REFUSED.into()));
        assert!(ok("{").is_err_and(|e| e.starts_with("bad request")));
        assert!(ok(r#"{"token":"t","cmd":5}"#).is_err_and(|e| e.contains("cmd")));
        assert!(ok(r#"{"token":"t","cmd":"open","args":[1]}"#).is_err_and(|e| e.contains("args")));
    }

    #[test]
    fn tokens_are_random_hex() {
        let (a, b) = (token().unwrap(), token().unwrap());
        assert!(a.len() == 64 && a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
