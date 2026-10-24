//! Werkbank's files in %APPDATA%\<identifier>\: profiles.json (user-editable, also via Settings > Profiles),
//! layout.json (owned by the UI), screens\ (the last screen of shells, shown again after a restart) and
//! logs\werkbank.log.

use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{AppHandle, Manager};

pub fn es(e: impl ToString) -> String {
    e.to_string()
}

/// A terminal id from the UI (a UUID), checked before it becomes part of a file name.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// `werkbank --selftest` works in a folder of its own, so it never touches the real layout and profiles.
pub static SELFTEST_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match SELFTEST_DIR.get() {
        Some(d) => d.clone(),
        None => app.path().app_config_dir().map_err(es)?,
    };
    fs::create_dir_all(&dir).map_err(es)?;
    Ok(dir)
}

/// One line in logs\werkbank.log with the local time; at 1 MB it moves to werkbank.old.log (so at most 2 MB).
pub fn write_log(app: &AppHandle, line: &str) {
    let Ok(dir) = config_dir(app).map(|d| d.join("logs")) else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("werkbank.log");
    if fs::metadata(&path).is_ok_and(|m| m.len() > 1 << 20) {
        let _ = fs::rename(&path, dir.join("werkbank.old.log"));
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {}", now(), line.trim_end());
    }
}

#[cfg(windows)]
fn now() -> String {
    // SAFETY: GetLocalTime takes no arguments and cannot fail.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

#[cfg(not(windows))]
fn now() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    format!("@{s}")
}

/// The UI's own lines (errors, terminals that stopped, `werkbank` commands).
#[tauri::command]
pub fn log(app: AppHandle, line: String) {
    write_log(&app, &line);
}

/// Opens the log in the default editor (Settings > About).
#[tauri::command]
pub fn open_log(app: AppHandle) -> Result<(), String> {
    let path = config_dir(&app)?.join("logs").join("werkbank.log");
    if !path.exists() {
        write_log(&app, "log opened");
    }
    crate::shell_open(&path.to_string_lossy());
    Ok(())
}

/// Written next to the file first and then renamed over it, so a crash never leaves half a file.
fn write_atomic(path: &Path, data: impl AsRef<[u8]>) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(es)?;
    fs::rename(&tmp, path).map_err(es)
}

fn default_profiles() -> Value {
    json!([
        // `new` / `resume` are appended to `command`; {id} is the werkbank session id, so each pane keeps its own conversation
        { "name": "Claude Code", "command": [r"%USERPROFILE%\.local\bin\claude.exe"], "cwd": "%USERPROFILE%",
          "new": ["--session-id", "{id}"], "resume": ["--resume", "{id}"], "prestart": true },
        { "name": "Codex", "command": ["codex.exe"], "cwd": "%USERPROFILE%" },
        { "name": "PowerShell", "command": ["powershell.exe", "-NoLogo"], "cwd": "%USERPROFILE%" },
        { "name": "Command Prompt", "command": ["cmd.exe"], "cwd": "%USERPROFILE%" }
    ])
}

/// profiles.json is user-editable (written with defaults on first run); layout.json is owned by the UI.
#[tauri::command]
pub fn load(app: AppHandle) -> Result<Value, String> {
    let dir = config_dir(&app)?;
    let pf = dir.join("profiles.json");
    if !pf.exists() {
        fs::write(
            &pf,
            serde_json::to_string_pretty(&default_profiles()).map_err(es)?,
        )
        .map_err(es)?;
    }
    let mut profiles: Value = serde_json::from_str(&fs::read_to_string(&pf).map_err(es)?)
        .map_err(|e| format!("{}: {e}", pf.display()))?;
    // without a single profile no terminal can start: fall back to the defaults (the file stays as it is)
    if profiles.as_array().is_some_and(Vec::is_empty) {
        profiles = default_profiles();
    }
    let lf = dir.join("layout.json");
    let layout = match fs::read_to_string(&lf) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| {
            // keep the unreadable file for inspection instead of silently overwriting it
            let _ = fs::rename(&lf, dir.join("layout.json.bad"));
            write_log(
                &app,
                "layout.json could not be read; kept as layout.json.bad, starting empty",
            );
            Value::Null
        }),
        Err(_) => Value::Null,
    };
    Ok(json!({ "profiles": profiles, "layout": layout }))
}

#[tauri::command]
pub fn save_layout(app: AppHandle, layout: Value) -> Result<(), String> {
    write_atomic(&config_dir(&app)?.join("layout.json"), layout.to_string())
}

/// Settings > Profiles edits the profiles; written like layout.json, but readable for hand edits.
#[tauri::command]
pub fn save_profiles(app: AppHandle, profiles: Value) -> Result<(), String> {
    write_atomic(
        &config_dir(&app)?.join("profiles.json"),
        serde_json::to_string_pretty(&profiles).map_err(es)?,
    )
}

/// Opens profiles.json in the default editor, for the options the settings page does not show.
#[tauri::command]
pub fn open_profiles(app: AppHandle) -> Result<(), String> {
    crate::shell_open(&config_dir(&app)?.join("profiles.json").to_string_lossy());
    Ok(())
}

fn screen_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("invalid session id: {id}"));
    }
    let dir = config_dir(app)?.join("screens");
    fs::create_dir_all(&dir).map_err(es)?;
    Ok(dir.join(format!("{id}.txt")))
}

#[tauri::command]
pub fn save_screen(app: AppHandle, id: String, data: String) -> Result<(), String> {
    write_atomic(&screen_path(&app, &id)?, data)
}

#[tauri::command]
pub fn load_screen(app: AppHandle, id: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(screen_path(&app, &id)?).ok())
}

/// Removed terminals keep their screen file while undo can still bring them back; at startup the UI passes the
/// sessions that exist and every other screen file is deleted.
#[tauri::command]
pub fn prune_screens(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(config_dir(&app)?.join("screens")) else {
        return Ok(());
    };
    for path in entries.flatten().map(|e| e.path()) {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if !keep.iter().any(|k| k == stem) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}
