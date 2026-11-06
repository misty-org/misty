//! One program that is a whole set of shell tools: the same shell and the same commands on every
//! computer, written in Rust, with nothing for a person to install (docs/plans/app-permissions.md).
//!
//! It's called by many names. Misty puts links to it on `PATH`, so `rm` starts this program under the
//! name `rm`, and the shell treats each tool as an ordinary command, with pipes and redirects working
//! as they do anywhere. Under its OS profile this is the only program commands can start.
// This is its own program, confined by its OS profile, so the app's file gate isn't here to go through.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod applets;
mod archive;
mod shell;

use std::{ffi::OsStr, path::Path};

/// The name this program was started as: `rm` from `/some/folder/rm`, or `rm.exe` on Windows.
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
            // A link with an unknown name mustn't quietly run its arguments as a script.
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
