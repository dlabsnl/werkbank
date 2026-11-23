//! Reading Claude Code's conversation files (`<projects>\<folder>\<id>.jsonl`, one JSON record per line): the topic,
//! the last answer and a text search. Only serde_json, so it is tested natively (build.sh, src-tauri/native-tests).
//! shortcut: these records ("custom-title" / "ai-title", and "user" / "assistant" with `message.content`) are Claude
//! Code's own and not documented; when they change, the functions here find nothing (no topic, no answer, no
//! match) instead of failing, and the fixtures in the tests below are where to start.

use serde_json::Value;

/// The topic of a conversation: the last name given with /rename, else the last title Claude made up.
pub fn title(text: &str) -> Option<String> {
    let (mut ai, mut custom) = (None, None);
    // the substring test only skips parsing most lines; the record's own type decides (tool schemas nest "type")
    for line in text.lines().filter(|l| l.contains("-title\"")) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let get = |k: &str| {
            v.get(k)
                .and_then(|t| t.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(String::from)
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("ai-title") => ai = get("aiTitle").or(ai),
            Some("custom-title") => custom = get("customTitle").or(custom),
            _ => {}
        }
    }
    custom.or(ai)
}

/// Skips parsing most lines (bookkeeping); the record's own type decides.
fn may_say(line: &str) -> bool {
    line.contains("\"type\":\"user\"") || line.contains("\"type\":\"assistant\"")
}

/// What was said in one record of the conversation itself: whether you said it (else Claude), and the text. None
/// for everything else: tool calls and their results, thinking, records Claude Code adds itself (isMeta), the
/// conversations of subagents (isSidechain) and the bookkeeping records.
fn said(line: &str) -> Option<(bool, String)> {
    if !may_say(line) {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let user = match v.get("type")?.as_str()? {
        "user" => true,
        "assistant" => false,
        _ => return None,
    };
    let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    if flag("isSidechain") || flag("isMeta") {
        return None;
    }
    let text = match v.get("message")?.get("content")? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text")?.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let text = text.trim();
    (!text.is_empty()).then(|| (user, text.to_string()))
}

/// Claude's last text message after your last prompt (`werkbank read`). None while that prompt has no answer in
/// text yet: never the answer to an earlier prompt.
pub fn last_answer(text: &str) -> Option<String> {
    let mut answer = None;
    for (user, said) in text.lines().filter_map(said) {
        answer = (!user).then_some(said);
    }
    answer
}

/// One lowercase character per character, so a place found in the folded text is the same place in the original
/// (`str::to_lowercase` can change the length: İ becomes two characters).
fn fold(text: &str) -> String {
    text.chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect()
}

/// The last place `query` occurs in what you or Claude said, ignoring case, with some text around it on one line.
/// From the end of the conversation backwards, in time linear in its size (measured: `search_speed` below).
/// shortcut: the whole conversation is read for every search (they run to many MB); an index when that gets slow.
pub fn find(text: &str, query: &str) -> Option<String> {
    let needle = fold(query.trim());
    if needle.is_empty() {
        return None;
    }
    // every record of the conversation is parsed (most of the file is tool output, which parsing passes quickly),
    // only what was said is folded and searched. Looking for the words in the raw line first was measured too:
    // folding every line costs four times what parsing it does.
    text.lines()
        .rev()
        .filter_map(said)
        .find_map(|(_, said)| snippet(&said, &needle))
}

/// The most terminals a search gives back; it stops reading conversations there.
pub const MAX_MATCHES: usize = 20;

/// The conversations (by terminal id, in the order given) that mention `query`, each with the place. `read` gives
/// a conversation's text; `stale` is asked before each one and ends the search when a newer one has replaced it.
pub fn search(
    ids: impl IntoIterator<Item = String>,
    query: &str,
    read: impl Fn(&str) -> Option<String>,
    stale: impl Fn() -> bool,
) -> Vec<(String, String)> {
    let mut hits = Vec::new();
    for id in ids {
        if stale() {
            return Vec::new();
        }
        if hits.len() == MAX_MATCHES {
            break;
        }
        if let Some(place) = read(&id).and_then(|text| find(&text, query)) {
            hits.push((id, place));
        }
    }
    hits
}

fn snippet(said: &str, needle: &str) -> Option<String> {
    // str::rfind is linear in the text (two-way search); the fold keeps one character per character, so the
    // place counts the same in the original
    let folded = fold(said);
    let at = folded[..folded.rfind(needle)?].chars().count();
    let chars: Vec<char> = said.chars().collect();
    let len = needle.chars().count();
    let (from, to) = (at.saturating_sub(40), (at + len + 60).min(chars.len()));
    let cut: String = chars[from..to].iter().collect();
    let line = cut.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(format!(
        "{}{line}{}",
        if from > 0 { "…" } else { "" },
        if to < chars.len() { "…" } else { "" }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn title_from_transcript() {
        let t = [
            r#"{"type":"user","schema":{"type":"ai-title","aiTitle":"nested, not a record"}}"#,
            r#"{"type":"ai-title","aiTitle":"First topic","sessionId":"a"}"#,
            r#"{"type":"ai-title","aiTitle":"Later topic","sessionId":"a"}"#,
            r#"not json -title""#,
        ]
        .join("\n");
        assert_eq!(title(&t).as_deref(), Some("Later topic"));
        let renamed = format!(
            "{t}\n{}",
            r#"{"type":"custom-title","customTitle":"My name"}"#
        );
        assert_eq!(title(&renamed).as_deref(), Some("My name"));
        assert_eq!(title(r#"{"type":"user"}"#), None);
    }

    // made up, in the shape Claude Code 2.1 writes: one content block per assistant record
    const TALK: &[&str] = &[
        r#"{"type":"ai-title","aiTitle":"Fix the tests"}"#,
        r#"{"type":"user","isSidechain":false,"message":{"role":"user","content":"run the tests"}}"#,
        r#"{"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"thinking","thinking":"secret plan"}]}}"#,
        r#"{"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"text","text":"Running them now."}]}}"#,
        r#"{"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test"}}]}}"#,
        r#"{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"2 failed: needle-in-tool-output"}]}}"#,
        r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"subagent chatter"}]}}"#,
        r#"{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"text","text":"a reminder Claude Code added"}]}}"#,
        r#"{"type":"assistant","isSidechain":false,"message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Two tests failed.\nBoth are fixed."}]}}"#,
        r#"{"type":"api-request-blob","message":{"content":[{"type":"text","text":"bookkeeping"}]}}"#,
        "not json at all",
    ];

    #[test]
    fn last_answer_is_the_text_after_the_last_prompt() {
        let done = TALK.join("\n");
        assert_eq!(
            last_answer(&done).as_deref(),
            Some("Two tests failed.\nBoth are fixed.")
        );
        // a new prompt without an answer yet: not the answer to the one before
        let asked = format!(
            "{done}\n{}",
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"and now the linter"}]}}"#
        );
        assert_eq!(last_answer(&asked), None);
        // only a tool call so far: still no answer
        let working = format!(
            "{asked}\n{}",
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{}}]}}"#
        );
        assert_eq!(last_answer(&working), None);
        let answered = format!(
            "{working}\n{}",
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Lint is clean."}]}}"#
        );
        assert_eq!(last_answer(&answered).as_deref(), Some("Lint is clean."));
        assert_eq!(last_answer(""), None);
        assert_eq!(last_answer(r#"{"type":"user","message":{}}"#), None);
    }

    #[test]
    fn find_searches_what_was_said() {
        let t = TALK.join("\n");
        assert_eq!(
            find(&t, "BOTH ARE").as_deref(),
            Some("Two tests failed. Both are fixed.")
        );
        assert_eq!(find(&t, "run the").as_deref(), Some("run the tests"));
        // not tool output, thinking, subagents, added reminders or bookkeeping
        for hidden in [
            "needle-in-tool",
            "secret plan",
            "chatter",
            "reminder",
            "bookkeeping",
            "npm test",
        ] {
            assert_eq!(find(&t, hidden), None, "{hidden}");
        }
        assert_eq!(find(&t, "  "), None);
        assert_eq!(find(&t, "no such words"), None);
    }

    #[test]
    fn find_does_not_skip_what_json_escapes() {
        // quotes, backslashes and line breaks are written with a backslash in the file: still found
        let line = json!({ "type": "user", "message": { "content": "say \"hello\" in C:\\temp\nand\tgo" } }).to_string();
        for needle in ["\"hello\"", "c:\\temp", "temp\nand", "and\tgo", "say"] {
            assert!(find(&line, needle).is_some(), "{needle:?}");
        }
        assert_eq!(find(&line, "\"bye\""), None);
        // words that only stand in a tool result on the same line of the file do not count
        let tool = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"deploy log"},{"type":"text","text":"looks fine"}]}}"#;
        assert_eq!(find(tool, "deploy"), None);
        assert_eq!(find(tool, "LOOKS").as_deref(), Some("looks fine"));
    }

    #[test]
    fn search_stops_at_the_cap_and_when_replaced() {
        use std::cell::Cell;
        let ids = || (0..50).map(|n| n.to_string());
        let talk = |id: &str| (id != "3").then(|| TALK.join("\n"));
        let all = search(ids(), "both are", talk, || false);
        assert_eq!(all.len(), MAX_MATCHES);
        assert_eq!(all[3].0, "4"); // 3 has no conversation: skipped, the order kept
        assert_eq!(all[0].1, "Two tests failed. Both are fixed.");
        assert_eq!(search(ids(), "no such words", talk, || false), vec![]);
        // a newer search replaced this one after two conversations: it reads no further and gives nothing
        let read = Cell::new(0);
        let counting = |id: &str| {
            read.set(read.get() + 1);
            talk(id)
        };
        assert_eq!(
            search(ids(), "both are", counting, || read.get() == 2),
            vec![]
        );
        assert_eq!(read.get(), 2);
        // at the cap it stops reading too
        read.set(0);
        search(ids(), "both are", counting, || false);
        assert_eq!(read.get(), MAX_MATCHES + 1); // the one without a conversation was asked for as well
    }

    /// Not part of the build (`cargo test -- --ignored --nocapture search_speed`, with --release): how long a
    /// search takes over one conversation of about 100 MB, mostly tool output, as real ones are.
    #[test]
    #[ignore]
    fn search_speed() {
        // full of what JSON writes with a backslash, as real tool output is
        let tool_output =
            "error TS2339: Property \"x\" does not exist in C:\\src\\app.ts\n".repeat(330);
        let mut text = String::new();
        let mut n = 0;
        while text.len() < 100 << 20 {
            n += 1;
            text.push_str(&json!({ "type": "user", "isSidechain": false, "message": { "role": "user", "content": format!("prompt number {n} about the invoices") } }).to_string());
            text.push('\n');
            for _ in 0..40 {
                text.push_str(&json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": tool_output }] } }).to_string());
                text.push('\n');
                text.push_str(&json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Checked the next file, nothing odd in it. ".repeat(20) }] } }).to_string());
                text.push('\n');
                text.push_str(
                    r#"{"type":"attachment","data":"bookkeeping bookkeeping bookkeeping"}"#,
                );
                text.push('\n');
            }
        }
        let time = |what: &str, needle: &str, found: bool| {
            let t0 = std::time::Instant::now();
            assert_eq!(find(&text, needle).is_some(), found, "{what}");
            println!("{what}: {:?} over {} MB", t0.elapsed(), text.len() >> 20);
        };
        time(
            "said once, at the very start (the whole file is read)",
            "prompt number 1 about",
            true,
        );
        time("not said anywhere", "zebra crossing", false);
        time("said in the last message", "nothing odd", true);
    }

    #[test]
    fn snippets_are_cut_by_characters() {
        let long = format!(
            "{} Η ΠΑΡΑΓΓΕΛΊΑ İstanbul'a gönderildi {}",
            "α".repeat(100),
            "ω".repeat(100)
        );
        let line = serde_json::json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": long }] } })
            .to_string();
        let hit = find(&line, "παραγγελία").unwrap();
        assert!(hit.contains("ΠΑΡΑΓΓΕΛΊΑ"), "{hit}");
        assert!(hit.starts_with('…') && hit.ends_with('…'), "{hit}");
        assert!(hit.chars().count() <= 40 + 10 + 60 + 2, "{hit}");
        // İ lowercases to two characters; the place still fits the original
        assert!(find(&line, "gönderildi").unwrap().contains("gönderildi"));
        assert!(find(&line, "istanbul").unwrap().contains("İstanbul"));
    }
}
