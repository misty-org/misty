// Taking Hermes Agent's folder back off Windows' user PATH: only the entry its installer added,
// and only when it wasn't there before.

use super::user_path::without_added_entry;

const BIN: &str = r"C:\Users\me\AppData\Local\hermes\bin";

/// `%LOCALAPPDATA%` as Windows would expand it; anything else stays as written.
fn expand(value: &str) -> String {
    value.replace("%LOCALAPPDATA%", r"C:\Users\me\AppData\Local")
}

fn fixed(before: Option<&str>, after: &str) -> Option<String> {
    without_added_entry(before, after, BIN, expand)
}

#[test]
fn the_entry_the_installer_put_first_comes_back_out() {
    // install.ps1 writes "$binDir;$userPath".
    let before = r"C:\tools;%USERPROFILE%\bin";
    let after = format!("{BIN};{before}");
    assert_eq!(fixed(Some(before), &after).as_deref(), Some(before));
}

#[test]
fn a_trailing_semicolon_and_empty_entries_stay_as_they_were() {
    let before = r"C:\tools;;D:\x;";
    let after = format!("{BIN};{before}");
    assert_eq!(fixed(Some(before), &after).as_deref(), Some(before));
}

#[test]
fn no_user_path_before_leaves_only_what_the_script_wrote_after_it() {
    // An empty user PATH becomes "<bin>;", which goes back to nothing.
    assert_eq!(fixed(None, &format!("{BIN};")).as_deref(), Some(""));
    assert_eq!(fixed(Some(""), &format!("{BIN};")).as_deref(), Some(""));
}

#[test]
fn an_entry_that_was_there_before_stays_however_it_was_written() {
    let after = format!("{BIN};C:\\tools");
    assert_eq!(fixed(Some(&after), &after), None);
    // Another case, a trailing backslash, the unexpanded form or quotes: still the same folder.
    for before in [
        r"C:\tools;c:\users\ME\appdata\local\HERMES\BIN",
        r"C:\tools;C:\Users\me\AppData\Local\hermes\bin\",
        r"%LOCALAPPDATA%\hermes\bin;C:\tools",
        r#""C:/Users/me/AppData/Local/hermes/bin";C:\tools"#,
    ] {
        assert_eq!(fixed(Some(before), &after), None, "{before}");
    }
}

#[test]
fn every_copy_the_script_added_goes_and_nothing_else() {
    let before = r"C:\tools";
    let after = format!(r"{BIN};C:\tools;c:\users\me\appdata\local\hermes\bin\");
    assert_eq!(fixed(Some(before), &after).as_deref(), Some(before));
    // The unexpanded form Hermes's own updater writes counts as the same entry.
    let after = r"%LOCALAPPDATA%\hermes\bin;C:\tools";
    assert_eq!(fixed(Some(before), after).as_deref(), Some(before));
}

#[test]
fn changes_made_by_others_meanwhile_are_kept() {
    let before = r"C:\tools";
    let after = format!(r"{BIN};C:\tools;C:\new");
    assert_eq!(
        fixed(Some(before), &after).as_deref(),
        Some(r"C:\tools;C:\new")
    );
}

#[test]
fn nothing_changes_when_the_script_added_nothing() {
    assert_eq!(fixed(Some(r"C:\tools"), r"C:\tools"), None);
    assert_eq!(fixed(None, ""), None);
    // A folder that only starts the same way isn't the entry.
    let after = r"C:\Users\me\AppData\Local\hermes\bin2;C:\tools";
    assert_eq!(fixed(Some(r"C:\tools"), after), None);
    assert_eq!(without_added_entry(None, "a;b", "", expand), None);
}
