//! The command line that opens a file link from a terminal at its line. No dependencies, so it is tested natively
//! (build.sh), like expand.rs.

/// Editors Werkbank finds by itself, the first one installed wins: program (with %VARS%) and its arguments.
pub const KNOWN: &[(&str, &str)] = &[
    (
        r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
        "--goto {file}:{line}:{col}",
    ),
    (
        r"%ProgramFiles%\Microsoft VS Code\Code.exe",
        "--goto {file}:{line}:{col}",
    ),
    (
        r"%ProgramFiles%\Notepad++\notepad++.exe",
        "-n{line} -c{col} {file}",
    ),
];

/// Splits an editor command line (Settings) into program and arguments: spaces separate, double quotes group, so
/// `"C:\Program Files\Notepad++\notepad++.exe" -n{line} {file}` works. `{line}`, `{col}` and `{file}` are filled in
/// after splitting, so a file name with spaces stays one argument; without `{file}` the file goes last. Nothing here
/// goes through a shell.
/// Without an editor: Notepad by its full path (a notepad.exe next to Werkbank would be found first).
pub const FALLBACK: &str = r#""%SystemRoot%\System32\notepad.exe" {file}"#;

pub fn argv(command: &str, file: &str, line: u32, col: u32) -> Vec<String> {
    let mut parts = Vec::new();
    let (mut cur, mut quoted, mut started) = (String::new(), false, false);
    for c in command.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    parts.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        parts.push(cur);
    }
    let has_file = parts.iter().skip(1).any(|p| p.contains("{file}"));
    let (line, col) = (line.to_string(), col.to_string());
    let mut out: Vec<String> = parts
        .iter()
        .enumerate()
        // never in the program itself: `{file}` there would run the clicked file
        .map(|(i, p)| {
            if i == 0 {
                p.clone()
            } else {
                p.replace("{line}", &line)
                    .replace("{col}", &col)
                    .replace("{file}", file)
            }
        })
        .collect();
    if !has_file {
        out.push(file.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{argv, FALLBACK};

    #[test]
    fn fills_in_the_placeholders() {
        assert_eq!(
            argv("code --goto {file}:{line}:{col}", r"C:\a b\x.rs", 12, 5),
            ["code", "--goto", r"C:\a b\x.rs:12:5"]
        );
    }

    #[test]
    fn quotes_group_a_program_with_spaces() {
        assert_eq!(
            argv(
                r#""C:\Program Files\Notepad++\notepad++.exe" -n{line} -c{col} {file}"#,
                r"C:\x.rs",
                3,
                1
            ),
            [
                r"C:\Program Files\Notepad++\notepad++.exe",
                "-n3",
                "-c1",
                r"C:\x.rs"
            ]
        );
    }

    #[test]
    fn the_file_goes_last_without_a_placeholder() {
        assert_eq!(argv("  notepad  ", "x.txt", 1, 1), ["notepad", "x.txt"]);
    }

    #[test]
    fn a_file_name_is_not_filled_in_again() {
        assert_eq!(argv("e {file}", "{line}.txt", 7, 1), ["e", "{line}.txt"]);
    }

    #[test]
    fn the_fallback_is_notepad_by_its_full_path() {
        assert_eq!(
            argv(FALLBACK, "x.txt", 1, 1),
            [r"%SystemRoot%\System32\notepad.exe", "x.txt"]
        );
    }

    #[test]
    fn the_file_is_never_the_program() {
        assert_eq!(argv("{file}", "x.exe", 1, 1), ["{file}", "x.exe"]);
    }

    #[test]
    fn empty_quotes_are_an_empty_argument() {
        assert_eq!(argv(r#"e "" {file}"#, "x", 1, 1), ["e", "", "x"]);
    }
}
