//! The programs in the terminals: each runs in its own pseudo console (ConPTY), keyed by the UI's session id.

use crate::{
    api,
    expand::expand,
    store::{es, valid_id},
};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{mpsc, Mutex},
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State,
};

struct Pty {
    master: Box<dyn MasterPty + Send>,
    // to this terminal's writer thread: a write blocks while the program does not read, and that must hold up neither
    // the window nor the other terminals; one queue keeps the keystrokes in order
    input: mpsc::Sender<String>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

/// The programs in the terminals end with Werkbank, also when it crashes or is killed: they are put in a Windows
/// job that closes with Werkbank's process. A Claude left running would keep its conversation locked, and the next
/// start says "Session ID … is already in use". What the programs start themselves breaks away from the job (like an
/// editor opened from a shell), so only the programs Werkbank started end with it.
#[cfg(windows)]
fn end_with_werkbank(pid: u32) {
    use std::sync::OnceLock;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};
    // the job handle stays open for Werkbank's lifetime; Windows closes it, and so ends the programs, at exit
    static JOB: OnceLock<usize> = OnceLock::new();
    let job = *JOB.get_or_init(|| {
        // SAFETY: no pointers are passed (no security attributes, no name); the result is checked.
        let Ok(job) = (unsafe { CreateJobObjectW(None, None) }) else {
            return 0;
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        // SAFETY: `info` is the JOBOBJECT_EXTENDED_LIMIT_INFORMATION this information class expects, with its own size,
        // and outlives the call; `job` is the handle created above.
        let set = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&info).cast(),
                u32::try_from(std::mem::size_of_val(&info)).unwrap_or_default(),
            )
        };
        if set.is_err() {
            // SAFETY: `job` was created above and is not used after this.
            let _ = unsafe { CloseHandle(job) };
            return 0;
        }
        job.0 as usize
    });
    if job == 0 {
        return;
    }
    // SAFETY: no pointers are passed; the result is checked.
    let Ok(process) = (unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) })
    else {
        return;
    };
    // SAFETY: `job` is the job handle kept open for Werkbank's lifetime (JOB); `process` was just opened with the
    // rights AssignProcessToJobObject needs.
    let _ = unsafe { AssignProcessToJobObject(HANDLE(job as *mut _), process) };
    // SAFETY: `process` was opened above and is not used after this.
    let _ = unsafe { CloseHandle(process) };
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<String, Pty>>);

const CLAUDE_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_EFFORT",
    "CLAUDE_PID",
];

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri hands over each argument of the UI call separately
pub fn spawn(
    app: AppHandle,
    ptys: State<Ptys>,
    id: String,
    command: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> Result<(), String> {
    let argv: Vec<String> = command.iter().map(|a| expand(a)).collect();
    let (prog, args) = argv.split_first().ok_or("empty command")?;
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(es)?;
    let mut cmd = CommandBuilder::new(prog);
    cmd.args(args);
    // When Werkbank itself was started from inside a Claude Code session it inherits that session's markers; a
    // Claude started with them thinks it is a sub-session and does not save its transcript (and gets the parent's
    // messaging token), so they never reach the terminals.
    // Claude Code also sets NO_COLOR=1 in its tool shells, which turned every terminal black and white.
    if std::env::var_os("CLAUDECODE").is_some() {
        cmd.env_remove("NO_COLOR");
    }
    for var in CLAUDE_SESSION_VARS {
        cmd.env_remove(var);
    }
    // Claude Code reports busy/idle as a progress bar (OSC 9;4) only to terminals it knows read it: ConEmu-style ones,
    // and never to Windows Terminal. The UI reads it as "Claude is done" (terminal.js); ConEmuANSI=ON also tells
    // programs the terminal speaks ANSI, which is true. WT_SESSION is inherited when Werkbank was opened from there.
    cmd.env_remove("WT_SESSION");
    cmd.env("ConEmuANSI", "ON");
    // Terminals can control Werkbank with the `werkbank` command (see api.rs): its address + token, and its own
    // folder at the end of PATH so the command resolves (last, so nothing in that folder can stand in for another
    // program).
    if let Some(api) = app.try_state::<api::Api>() {
        cmd.env("WERKBANK_ADDR", &api.addr);
        cmd.env("WERKBANK_TOKEN", &api.token);
        cmd.env("WERKBANK_TERMINAL", &id); // so `werkbank close` alone closes this terminal
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.to_path_buf()))
    {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let joined = std::env::join_paths(std::env::split_paths(&path).chain(std::iter::once(dir)));
        cmd.env("PATH", joined.unwrap_or(path));
    }
    if let Some(dir) = cwd
        .map(|d| expand(&d))
        .filter(|d| std::path::Path::new(d).is_dir())
    {
        cmd.cwd(dir);
    }
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("{prog}: {e}"))?;
    drop(pair.slave);
    let pid = child.process_id();
    #[cfg(windows)]
    if let Some(pid) = pid {
        end_with_werkbank(pid);
    }
    let mut reader = pair.master.try_clone_reader().map_err(es)?;
    let mut writer = pair.master.take_writer().map_err(es)?;
    let (input, queue) = mpsc::channel::<String>();
    // ends when the terminal's entry (and so the sender) is gone, or the program stopped reading for good
    std::thread::spawn(move || {
        for data in queue {
            if writer.write_all(data.as_bytes()).is_err() {
                break;
            }
        }
    });
    let killer = child.clone_killer();
    let replaced = ptys.0.lock().unwrap().insert(
        id.clone(),
        Pty {
            master: pair.master,
            input,
            killer,
            pid,
        },
    );
    // one program per terminal: one started again before the last one was gone (undo) takes its place
    if let Some(mut old) = replaced {
        let _ = old.killer.kill();
    }

    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            if on_data
                .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                .is_err()
            {
                break;
            }
        }
    });
    // ConPTY keeps the output pipe open after the child exits; dropping the master ends the reader.
    // The terminal may already run a new program under the same id (Ctrl+Z right after closing it), so the entry
    // is only removed when it still is this program; the exit goes to this start's own channel.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let ptys = app.state::<Ptys>();
        let mut map = ptys.0.lock().unwrap();
        if map.get(&id).is_some_and(|p| p.pid == pid) {
            map.remove(&id);
        }
        drop(map);
        let _ = on_exit.send(code);
    });
    Ok(())
}

/// Whether Claude Code saved a conversation under this id (`<config>\projects\<folder>\<id>.jsonl`, config =
/// CLAUDE_CONFIG_DIR or %USERPROFILE%\.claude). Claude only saves one after its first prompt; resuming an id it never
/// saved fails with "No conversation found". True when it cannot tell, so a resume is never dropped by mistake.
#[tauri::command]
pub fn has_conversation(id: String) -> bool {
    if !valid_id(&id) {
        return false;
    }
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE").map(|h| std::path::Path::new(&h).join(".claude"))
        });
    let Some(Ok(dirs)) = root.map(|r| std::fs::read_dir(r.join("projects"))) else {
        return true;
    };
    dirs.flatten()
        .any(|d| d.path().join(format!("{id}.jsonl")).is_file())
}

// sync and instant: it only queues the text for the terminal's writer thread, in the order the UI sent it
#[tauri::command]
pub fn write(ptys: State<Ptys>, id: String, data: String) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    let pty = map.get(&id).ok_or("no such session")?;
    pty.input
        .send(data)
        .map_err(|_| "the program no longer reads its input".into())
}

#[tauri::command]
pub fn resize(ptys: State<Ptys>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    let pty = map.get(&id).ok_or("no such session")?;
    pty.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(es)
}

#[tauri::command]
pub fn kill(ptys: State<Ptys>, id: String) -> Result<(), String> {
    let mut map = ptys.0.lock().unwrap();
    let pty = map.get_mut(&id).ok_or("no such session")?;
    pty.killer.kill().map_err(es)
}
