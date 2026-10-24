//! Local control API, so programs running inside a Werkbank terminal (e.g. Claude Code) can list, open and close
//! terminals and type a task into one with the `werkbank` command. It listens on 127.0.0.1 only, and every request must carry the token
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

  werkbank list                                  groups and terminals with their status
  werkbank open [--profile P] [--group G] [--name N] [--show | --split right|down]
                                                 open a terminal (in the background unless --show / --split)
  werkbank close [<name or id>]                  stop and remove a terminal (not in a locked group); without a
                                                 name: the terminal it runs in, also in a locked group (e.g. a
                                                 Claude asked to end its conversation)
  werkbank send <name or id> <text> [--no-enter] type text into a terminal and press Enter (once its program is
                                                 ready; a stopped terminal is started first)
  werkbank open ... --prompt <text>              open a terminal and give it a first task the same way

send only types text: control characters and escape codes are dropped. Opening and closing can be undone in
Werkbank with Ctrl+Z.";

/// `werkbank <command> ...` run from a terminal inside Werkbank: send the request, print the answer, exit code.
pub fn run_cli(args: &[String]) -> i32 {
    attach_console();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    if matches!(cmd, "help" | "--help" | "-h") {
        println!("{HELP}");
        return 0;
    }
    let (Ok(addr), Ok(token)) = (
        std::env::var("WERKBANK_ADDR"),
        std::env::var("WERKBANK_TOKEN"),
    ) else {
        eprintln!("werkbank: run this inside a Werkbank terminal (WERKBANK_ADDR / WERKBANK_TOKEN are not set)");
        return 1;
    };
    let mut opts = serde_json::Map::new();
    let mut text = Vec::new();
    let mut rest = args.iter().skip(1);
    while let Some(a) = rest.next() {
        match a.as_str() {
            "--profile" | "--group" | "--name" | "--split" | "--prompt" => {
                let Some(v) = rest.next() else {
                    eprintln!("werkbank: {a} needs a value");
                    return 1;
                };
                opts.insert(a.trim_start_matches("--").into(), json!(unmangle(v)));
            }
            "--show" | "--no-enter" => {
                opts.insert(a.trim_start_matches("--").into(), json!(true));
            }
            other if (cmd == "close" || cmd == "send") && !opts.contains_key("name") => {
                opts.insert("name".into(), json!(other));
            }
            // send: everything after the terminal is the text, so quotes are optional
            other if cmd == "send" => text.push(unmangle(other)),
            other => {
                eprintln!("werkbank: unknown argument {other}\n\n{HELP}");
                return 1;
            }
        }
    }
    if cmd == "send" {
        if !opts.contains_key("name") {
            eprintln!("werkbank: send needs a terminal name or id, then the text");
            return 1;
        }
        opts.insert("text".into(), json!(text.join(" ")));
    }
    if cmd == "close" && !opts.contains_key("name") {
        let Ok(me) = std::env::var("WERKBANK_TERMINAL") else {
            eprintln!("werkbank: close needs a terminal name or id");
            return 1;
        };
        opts.insert("name".into(), json!(me));
        opts.insert("self".into(), json!(true));
    }
    let reply = (|| -> std::io::Result<Value> {
        let mut s = TcpStream::connect(&addr)?;
        s.set_read_timeout(Some(Duration::from_secs(15)))?;
        writeln!(s, "{}", json!({ "token": token, "cmd": cmd, "args": opts }))?;
        let mut line = String::new();
        BufReader::new(s).read_line(&mut line)?;
        serde_json::from_str(&line).map_err(std::io::Error::other)
    })();
    match reply {
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
            println!(
                "  {:<28} {:<14} {:<8} {}{}",
                t["name"].as_str().unwrap_or("?"),
                t["profile"].as_str().unwrap_or(""),
                t["status"].as_str().unwrap_or(""),
                id.get(..8).unwrap_or(id),
                if t["visible"] == json!(true) {
                    "  (in window)"
                } else {
                    ""
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
