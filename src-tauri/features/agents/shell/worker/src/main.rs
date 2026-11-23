#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod applets;
mod archive;
mod shell;

use std::{ffi::OsStr, path::Path};

fn called_as(first: Option<&OsStr>) -> String {
    let stem = first
        .map(Path::new)
        .and_then(Path::file_stem)
        .unwrap_or_default();
    stem.to_string_lossy().to_ascii_lowercase()
}

const COMMAND_NOT_FOUND: i32 = 127;

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let name = called_as(args.first().map(|arg| arg.as_os_str()));
    let code = applets::run(&name, &args).unwrap_or_else(|| {
        if matches!(name.as_str(), "sh" | "bash" | "misty-agent-shell") {
            shell::run(&args)
        } else {
            eprintln!("{name}: not one of Misty's tools");
            COMMAND_NOT_FOUND
        }
    });
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::called_as;
    use std::ffi::OsStr;

    #[test]
    fn a_tool_is_named_by_its_file_whatever_the_folder_or_extension() {
        for (path, name) in [("/a/b/rm", "rm"), ("rm", "rm"), ("C:/tools/RM.EXE", "rm"), ("./sort", "sort")] {
            assert_eq!(called_as(Some(OsStr::new(path))), name);
        }
        assert_eq!(called_as(None), "");
    }
}
