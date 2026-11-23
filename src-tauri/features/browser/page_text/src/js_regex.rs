use regex::Regex;

const SPACE: &str = r"\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}";

fn translate(pattern: &str, ignore_case: bool) -> String {
    let characters: Vec<char> = pattern.chars().collect();
    let mut out = String::with_capacity(pattern.len() * 2);
    let mut in_class = false;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        index += 1;
        if character == '\\' {
            let Some(&escaped) = characters.get(index) else {
                break;
            };
            index += 1;
            match (escaped, in_class) {
                ('s', true) => out.push_str(SPACE),
                ('s', false) => out.push_str(&format!("[{SPACE}]")),
                ('S', false) => out.push_str(&format!("[^{SPACE}]")),
                ('d', true) => out.push_str("0-9"),
                ('d', false) => out.push_str("[0-9]"),
                ('w', true) => out.push_str("0-9A-Za-z_"),
                ('w', false) => out.push_str("[0-9A-Za-z_]"),
                ('b', false) => out.push_str(r"(?-u:\b)"),
                _ => {
                    out.push('\\');
                    out.push(escaped);
                }
            }
            continue;
        }
        if in_class {
            match character {
                ']' => {
                    in_class = false;
                    out.push(']');
                }
                '[' | '&' | '~' => {
                    out.push('\\');
                    out.push(character);
                }
                letter if ignore_case && letter.is_ascii_alphabetic() => {
                    let range_end = (characters.get(index) == Some(&'-'))
                        .then(|| characters.get(index + 1).copied())
                        .flatten()
                        .filter(char::is_ascii_alphabetic);
                    let end = range_end.unwrap_or(letter);
                    if range_end.is_some() {
                        index += 2;
                    }
                    let (lower_start, lower_end) =
                        (letter.to_ascii_lowercase(), end.to_ascii_lowercase());
                    let (upper_start, upper_end) =
                        (letter.to_ascii_uppercase(), end.to_ascii_uppercase());
                    out.push_str(&format!(
                        "{lower_start}-{lower_end}{upper_start}-{upper_end}"
                    ));
                }
                other => out.push(other),
            }
            continue;
        }
        match character {
            '[' => {
                in_class = true;
                out.push('[');
                if characters.get(index) == Some(&'^') {
                    out.push('^');
                    index += 1;
                }
            }
            '.' => out.push_str(r"[^\n\r\u{2028}\u{2029}]"),
            letter if ignore_case && letter.is_ascii_alphabetic() => {
                out.push_str(&format!(
                    "[{}{}]",
                    letter.to_ascii_lowercase(),
                    letter.to_ascii_uppercase()
                ));
            }
            other => out.push(other),
        }
    }
    out
}

pub fn js_regex(pattern: &str, ignore_case: bool) -> Regex {
    Regex::new(&translate(pattern, ignore_case))
        .expect("a fixed pattern from the TypeScript runtime compiles")
}

pub fn try_js_regex(pattern: &str, ignore_case: bool) -> Option<Regex> {
    Regex::new(&translate(pattern, ignore_case)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_classes_stay_ascii() {
        assert!(js_regex(r"\bcafe\b", false).is_match("a cafe."));
        assert!(js_regex(r"\bcaf\b", false).is_match("café"));
        assert!(!js_regex(r"\d", false).is_match("٣"));
        assert!(!js_regex(r"^\w+$", false).is_match("é"));
    }

    #[test]
    fn spaces_are_javascripts() {
        let space = js_regex(r"^\s$", false);
        assert!(space.is_match("\u{FEFF}"));
        assert!(space.is_match("\u{A0}"));
        assert!(!space.is_match("\u{85}"));
        assert!(js_regex(r"^[^\s]$", false).is_match("\u{85}"));
        assert!(js_regex(r"^\S$", false).is_match("\u{85}"));
    }

    #[test]
    fn ignoring_case_folds_only_ascii() {
        let word = js_regex(r"^sky$", true);
        assert!(word.is_match("SKY"));
        assert!(word.is_match("sKy"));
        assert!(!word.is_match("ſky"));
        assert!(!word.is_match("s\u{212A}y"));
        let class = js_regex(r"^[a-c_x]+$", true);
        assert!(class.is_match("aBc_X"));
        assert!(!class.is_match("d"));
        assert!(js_regex(r"^[^a-z]+$", true).is_match("1"));
        assert!(!js_regex(r"^[^a-z]+$", true).is_match("A"));
    }

    #[test]
    fn dots_and_brackets_read_as_in_javascript() {
        assert!(!js_regex(r"^.$", false).is_match("\u{2028}"));
        assert!(js_regex(r"^.$", false).is_match("a"));
        assert!(js_regex(r"^[\[]$", false).is_match("["));
        assert!(js_regex(r"^[\s)\]>]+$", false).is_match(" )]>"));
        assert!(js_regex(r"^documentId\\*$", false).is_match(r"documentId\\"));
    }
}
