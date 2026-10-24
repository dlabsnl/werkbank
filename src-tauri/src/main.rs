#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod editor;
mod expand;
mod icon;
mod notify;
mod pty;
mod store;

use tauri::{AppHandle, Emitter, Manager};

/// Icon of a profile's program as (width, height, RGBA pixels); None when it has no usable icon.
#[tauri::command]
fn program_icon(program: String) -> Option<(u32, u32, Vec<u8>)> {
    icon::rgba(&icon::resolve(&program)?)
}

/// Bytes of an image file set as a profile's "icon" (.png/.ico/.svg/.jpg).
#[tauri::command]
fn icon_file(path: String) -> Option<Vec<u8>> {
    icon::image_file(&path)
}

/// Opens a link or file the way Explorer does (default browser / editor).
pub fn shell_open(target: &str) {
    #[cfg(windows)]
    // SAFETY: every string is a valid, NUL-terminated wide string for the duration of the call; no window handle is
    // passed, which ShellExecuteW allows.
    unsafe {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(target),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// Opens a web link from a terminal (Ctrl+click) in the default browser; only http(s), nothing else is executed.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("not a web link: {url}"));
    }
    shell_open(&url);
    Ok(())
}

/// Opens a file link from a terminal (Ctrl+click on `path:line:col`) at its line: with the editor set in Settings,
/// else the first one installed (editor::KNOWN), else Notepad (Explorer's way would run a .bat or .exe). Only an existing file; a relative
/// path counts from the terminal's folder. The path is passed as one argument, never run.
#[tauri::command]
fn open_file(
    path: String,
    line: Option<u32>,
    col: Option<u32>,
    cwd: Option<String>,
    editor: Option<String>,
) -> Result<(), String> {
    let mut file = std::path::PathBuf::from(expand::expand(&path));
    if file.is_relative() {
        // a terminal without a folder of its own starts in Werkbank's
        let base = cwd
            .map(|d| expand::expand(&d))
            .or_else(|| Some(std::env::current_dir().ok()?.display().to_string()))
            .ok_or("no folder to find it in")?;
        file = std::path::Path::new(&base).join(file);
    }
    // a network path (printed by a program, or the terminal's folder) would make Windows connect (and send your login) just to check it
    let text = file.to_string_lossy();
    if text.starts_with(r"\\") || text.starts_with("//") {
        return Err(format!("not opening a network path: {text}"));
    }
    if !file.is_file() {
        return Err(format!("no such file: {}", file.display()));
    }
    let file = file.display().to_string();
    let command = editor.filter(|e| !e.trim().is_empty()).or_else(|| {
        editor::KNOWN
            .iter()
            .map(|(program, args)| (expand::expand(program), args))
            .find(|(program, _)| std::path::Path::new(program).is_file())
            .map(|(program, args)| format!("\"{program}\" {args}"))
    });
    // any program can print a path, so a linked script or program must be shown, never run
    let command = command.unwrap_or_else(|| editor::FALLBACK.into());
    let argv = editor::argv(&command, &file, line.unwrap_or(1), col.unwrap_or(1));
    let (program, args) = argv.split_first().ok_or("empty editor command")?;
    std::process::Command::new(expand::expand(program))
        .args(args)
        .spawn()
        .map(drop)
        .map_err(|e| format!("{program}: {e}"))
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// When this run is `werkbank --selftest`: the name of the `werkbank` command, so ui/selftest.js can use it.
#[tauri::command]
fn selftest_exe() -> Option<String> {
    store::SELFTEST_DIR.get()?;
    let exe = std::env::current_exe().ok()?;
    Some(exe.file_stem()?.to_string_lossy().into_owned())
}

/// The end of `werkbank --selftest`: the report goes to the console (and selftest.txt in the throwaway folder), the
/// exit code says whether all checks passed.
#[tauri::command]
fn selftest_done(app: AppHandle, report: String, passed: bool) {
    let Some(dir) = store::SELFTEST_DIR.get() else {
        return;
    };
    let _ = std::fs::write(dir.join("selftest.txt"), &report);
    api::attach_console();
    println!("{report}");
    app.exit(i32::from(!passed));
}

fn bring_to_front(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // coming back from minimized, Windows only lets the window take the focus once the restore is done
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = w.set_focus();
        });
    }
}

/// A terminal set to come to the front when it is done (attention.js) brings the window forward.
#[tauri::command]
fn to_front(app: AppHandle) {
    bring_to_front(&app);
}

fn toggle_window(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) if w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false) => {
            let _ = w.minimize();
        }
        _ => bring_to_front(app),
    }
}

/// The terminal a clicked notification pointed at when that click started Werkbank.
static LAUNCH_TARGET: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[tauri::command]
fn launch_target() -> Option<String> {
    LAUNCH_TARGET.get().cloned()
}

fn main() {
    // `werkbank list|open|close|send|help` from inside a Werkbank terminal is a command-line client, not a second window;
    // plain `werkbank` inside one prints the help instead of starting another instance on the same layout.
    let args: Vec<String> = std::env::args().skip(1).collect();
    // `werkbank --selftest` runs ui/selftest.js against this exe in a throwaway folder (with two cmd profiles),
    // next to a running Werkbank, prints the result and exits with 0 when everything passed
    let selftest = args.first().is_some_and(|a| a == "--selftest");
    let inside = std::env::var_os("WERKBANK_ADDR").is_some();
    if !selftest
        && (inside
            || args.first().is_some_and(|a| {
                ["list", "open", "close", "send", "help", "--help", "-h"].contains(&a.as_str())
            }))
    {
        std::process::exit(api::run_cli(&args));
    }
    let mut builder = tauri::Builder::default();
    if selftest {
        // the folders of earlier runs go first (still in use by WebView2 when a run ends)
        let tmp = std::env::temp_dir();
        for old in std::fs::read_dir(&tmp).into_iter().flatten().flatten() {
            if old
                .file_name()
                .to_string_lossy()
                .starts_with("werkbank-selftest-")
            {
                let _ = std::fs::remove_dir_all(old.path());
            }
        }
        let dir = tmp.join(format!("werkbank-selftest-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        // its own browser data too, so it shares nothing with the Werkbank you are using
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("webview"));
        let profiles =
            r#"[{"name":"Cmd","command":["cmd.exe"]},{"name":"Cmd2","command":["cmd.exe"]}]"#;
        let _ = std::fs::write(dir.join("profiles.json"), profiles);
        let _ = store::SELFTEST_DIR.set(dir);
    } else {
        builder = builder
            // one Werkbank at a time: two windows on the same layout.json would overwrite each other's changes,
            // so starting it again brings the running one to the front instead (and opens the terminal a clicked
            // notification points at)
            .plugin(tauri_plugin_single_instance::init(|app, args, _| {
                bring_to_front(app);
                if let Some(id) = notify::link_target(app, &args) {
                    let _ = app.emit("show-terminal", id);
                }
            }))
            // the window is frameless by design; never restore the native title bar from an older saved state
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::all()
                            - tauri_plugin_window_state::StateFlags::DECORATIONS,
                    )
                    .build(),
            );
    }
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // Win+Ctrl+W from anywhere: Werkbank to the front, or minimized again when it already is in front
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, e| {
                    if e.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // started by a click on a notification: the UI asks for that terminal once it is up
            if let Some(id) = notify::link_target(app.handle(), &args) {
                let _ = LAUNCH_TARGET.set(id);
            }
            api::start(app.handle());
            if let Err(e) = notify::register(app.handle()) {
                store::write_log(app.handle(), &format!("notifications not registered: {e}"));
            }
            // Win+Ctrl+W: Win+Shift / Win+Alt combinations are often taken by other tools, and Ctrl+Alt is AltGr
            // on many keyboards. Taken anyway: Werkbank works without it.
            let _ = app.global_shortcut().register("super+control+KeyW");
            Ok(())
        })
        .manage(pty::Ptys::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // let the UI save layout and screens first (it calls `quit`); quit anyway if it does not answer
                api.prevent_close();
                let _ = window.emit("before-quit", ());
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    app.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            store::load,
            store::save_layout,
            store::save_screen,
            store::load_screen,
            store::prune_screens,
            store::save_profiles,
            store::open_profiles,
            store::log,
            store::open_log,
            selftest_exe,
            selftest_done,
            to_front,
            launch_target,
            program_icon,
            icon_file,
            open_url,
            open_file,
            notify::notify,
            api::api_reply,
            quit,
            pty::spawn,
            pty::has_conversation,
            pty::write,
            pty::resize,
            pty::kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running werkbank");
}
