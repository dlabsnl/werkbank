//! "When you are away, run a command" (Settings > Notifications, ui/attention.js): how long this PC has had no
//! keyboard or mouse input, and starting the command.

use crate::expand::expand;

/// Seconds since the last keyboard or mouse input on this PC, in any program; 0 when Windows cannot tell (so "away"
/// is never assumed by mistake).
#[tauri::command]
pub fn idle_seconds() -> u32 {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetTickCount;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO {
            cbSize: u32::try_from(std::mem::size_of::<LASTINPUTINFO>()).unwrap_or_default(),
            dwTime: 0,
        };
        // SAFETY: `info` is a live, writable LASTINPUTINFO with its size filled in, as the call requires.
        if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
            return 0;
        }
        // SAFETY: GetTickCount takes no arguments and cannot fail.
        let now = unsafe { GetTickCount() };
        // both are milliseconds since Windows started and wrap around together after 49 days
        now.wrapping_sub(info.dwTime) / 1000
    }
    #[cfg(not(windows))]
    0
}

/// A terminal's or group's name as the away command gets it: letters, digits, spaces and `._-`, anything else a
/// space, at most 64 characters. A terminal's name comes from the program in it (its title), and a command that
/// puts it into a shell line (`cmd /c ... %WERKBANK_AWAY_TERMINAL%`) would otherwise run what that program wrote.
fn safe_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " ._-".contains(c) {
                c
            } else {
                ' '
            }
        })
        .collect();
    kept.trim()
        .chars()
        .take(64)
        .collect::<String>()
        .trim_end()
        .into()
}

/// Starts the away command: a program with its arguments, never through a shell, `%VAR%` expanded like a profile's
/// command. Which terminal waits goes to it in environment variables and never into the arguments, with its names
/// cut down to plain words (`safe_name`) and its id checked.
#[tauri::command]
pub fn away_run(
    command: Vec<String>,
    terminal: String,
    group: String,
    id: String,
    minutes: u32,
) -> Result<(), String> {
    if !crate::store::valid_id(&id) {
        return Err("not a terminal id".into());
    }
    let argv: Vec<String> = command.iter().map(|a| expand(a)).collect();
    let (program, args) = argv.split_first().ok_or("empty command")?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .env("WERKBANK_AWAY_TERMINAL", safe_name(&terminal))
        .env("WERKBANK_AWAY_GROUP", safe_name(&group))
        .env("WERKBANK_AWAY_ID", id)
        .env("WERKBANK_AWAY_MINUTES", minutes.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: a console program (a script) does not flash a window over your work
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().map(drop).map_err(|e| format!("{program}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_for_the_away_command_are_plain_words() {
        assert_eq!(
            safe_name("Fix the tests v2.1_final-b"),
            "Fix the tests v2.1_final-b"
        );
        assert_eq!(
            safe_name("Παραγγελία İstanbul 42"),
            "Παραγγελία İstanbul 42"
        );
        // what a shell would act on becomes a space
        let hostile =
            safe_name("x & calc.exe | %PATH% ^ \"q\" $(id) `id` ; <a> 'b' !c! \r\n\x1b[31m");
        assert_eq!(
            hostile.split_whitespace().collect::<Vec<_>>(),
            ["x", "calc.exe", "PATH", "q", "id", "id", "a", "b", "c", "31m"]
        );
        assert!(hostile
            .chars()
            .all(|c| c.is_alphanumeric() || " ._-".contains(c)));
        assert_eq!(safe_name("  Research/Papers  "), "Research Papers");
        assert_eq!(safe_name(&"a".repeat(200)).chars().count(), 64);
        assert_eq!(safe_name(&format!("{} b", "a".repeat(63))), "a".repeat(63));
        assert_eq!(safe_name("&&&"), "");
    }

    #[test]
    fn the_away_command_needs_a_terminal_id() {
        let run = |id: &str| away_run(vec![], "t".into(), "g".into(), id.into(), 10);
        assert_eq!(run("x & calc"), Err("not a terminal id".into()));
        assert_eq!(run(""), Err("not a terminal id".into()));
        // a real id gets as far as the (empty) command
        assert_eq!(run("0f3a-11"), Err("empty command".into()));
    }
}
