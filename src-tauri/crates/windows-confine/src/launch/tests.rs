use super::command_line;
use windows_sys::Win32::{Foundation::LocalFree, UI::Shell::CommandLineToArgvW};

fn split(line: &std::ffi::OsStr) -> Vec<String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = line.encode_wide().chain([0]).collect();
    let mut count = 0;
    // SAFETY: a NUL-terminated line; the array is freed below.
    let list = unsafe { CommandLineToArgvW(wide.as_ptr(), &mut count) };
    let words = (0..count as usize)
        .map(|index| unsafe {
            let word = *list.add(index);
            let length = (0..).take_while(|&i| *word.add(i) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(word, length))
        })
        .collect();
    unsafe { LocalFree(list.cast()) };
    words
}

#[test]
fn arguments_survive_the_round_trip() {
    let arguments = [
        r"C:\Program Files\Tool\tool.exe",
        "plain",
        "",
        "two words",
        r#"say "hi""#,
        r"C:\ends\with\",
        r#"back\"quote"#,
        "-protocol_whitelist",
    ];
    let line = command_line(arguments);
    assert_eq!(split(&line), arguments);
}
