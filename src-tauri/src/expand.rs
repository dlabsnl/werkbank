/// Expands Windows-style %VAR% references; unknown variables and lone % are left as-is.
pub fn expand(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        let after = &rest[a + 1..];
        let Some(b) = after.find('%') else {
            out.push_str(&rest[a..]);
            return out;
        };
        match std::env::var(&after[..b]) {
            Ok(v) if b > 0 => {
                out.push_str(&v);
                rest = &after[b + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::expand;

    #[test]
    fn expands_known_and_keeps_unknown() {
        std::env::set_var("WB_TEST", "x");
        assert_eq!(expand(r"a%WB_TEST%\b"), r"ax\b");
        assert_eq!(expand("%WB_NOPE%"), "%WB_NOPE%");
        assert_eq!(expand("50% done"), "50% done");
        assert_eq!(expand("%%"), "%%");
    }
}
