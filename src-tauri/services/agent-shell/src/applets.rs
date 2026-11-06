//! The tools themselves. Each comes from uutils, the Rust rewrite of the standard Unix commands, or
//! from `archive` for the few it doesn't have.
use crate::archive;
use std::{
    ffi::OsString,
    io::Write,
};

/// Gets a uutils tool's messages ready and runs it the way its own program does.
fn uutils(name: &str, tool: impl FnOnce() -> i32) -> i32 {
    uucore::panic::mute_sigpipe_panic();
    if let Err(error) = uucore::locale::setup_localization(name) {
        eprintln!("{name}: {error}");
        return 99;
    }
    let code = tool();
    let _ = std::io::stdout().flush();
    code
}

/// Tools that read their arguments as text. A name that isn't valid text is refused rather than
/// altered, since a changed name could mean a different file.
fn with_text_args(name: &str, args: &[OsString], tool: impl FnOnce(&[&str]) -> i32) -> i32 {
    let Some(text) = args.iter().map(|arg| arg.to_str()).collect::<Option<Vec<_>>>() else {
        eprintln!("{name}: a file name isn't valid text");
        return 1;
    };
    tool(&text)
}

macro_rules! uutils_tools {
    ($($name:literal => $crate_name:ident),+ $(,)?) => {
        /// Every tool from uutils coreutils, by the name it's called.
        #[cfg(test)]
        const COREUTILS: &[&str] = &[$($name),+];

        fn coreutils(name: &str) -> Option<i32> {
            match name {
                $($name => Some(uutils(name, || $crate_name::uumain(uucore::args_os()))),)+
                _ => None,
            }
        }
    };
}

uutils_tools! {
    "base64" => uu_base64,
    "basename" => uu_basename,
    "cat" => uu_cat,
    "cksum" => uu_cksum,
    "comm" => uu_comm,
    "cp" => uu_cp,
    "csplit" => uu_csplit,
    "cut" => uu_cut,
    "date" => uu_date,
    "dirname" => uu_dirname,
    "du" => uu_du,
    "env" => uu_env,
    "expand" => uu_expand,
    "expr" => uu_expr,
    "fmt" => uu_fmt,
    "fold" => uu_fold,
    "head" => uu_head,
    "join" => uu_join,
    "ln" => uu_ln,
    "ls" => uu_ls,
    "mkdir" => uu_mkdir,
    "mktemp" => uu_mktemp,
    "mv" => uu_mv,
    "nl" => uu_nl,
    "od" => uu_od,
    "paste" => uu_paste,
    "readlink" => uu_readlink,
    "realpath" => uu_realpath,
    "rm" => uu_rm,
    "rmdir" => uu_rmdir,
    "seq" => uu_seq,
    "shuf" => uu_shuf,
    "sleep" => uu_sleep,
    "sort" => uu_sort,
    "split" => uu_split,
    "tac" => uu_tac,
    "tail" => uu_tail,
    "tee" => uu_tee,
    "touch" => uu_touch,
    "tr" => uu_tr,
    "truncate" => uu_truncate,
    "uniq" => uu_uniq,
    "wc" => uu_wc,
}

/// The tools from other uutils projects and from `archive`.
#[cfg(test)]
const OTHERS: &[&str] = &[
    "find", "grep", "sed", "xargs", "tar", "zip", "unzip", "gzip", "gunzip",
];

/// The names Misty links to this program.
#[cfg(test)]
const NAMES: &[&str] = include!("tool_names.in");

/// Runs the tool called `name`, or says there's none, in which case this program is the shell.
pub fn run(name: &str, args: &[OsString]) -> Option<i32> {
    coreutils(name).or_else(|| {
        Some(match name {
            "grep" => uutils_grep(),
            "sed" => uutils(name, || sed::sed::uumain(uucore::args_os())),
            "find" => with_text_args(name, args, |text| {
                findutils::find::find_main(text, &findutils::find::StandardDependencies::new())
            }),
            "xargs" => with_text_args(name, args, findutils::xargs::xargs_main),
            "tar" => archive::tar(&args[1..]),
            "zip" => archive::zip(&args[1..]),
            "unzip" => archive::unzip(&args[1..]),
            "gzip" => archive::gzip(&args[1..]),
            "gunzip" => archive::gunzip(&args[1..]),
            _ => return None,
        })
    })
}

/// uutils grep is built on an older uucore, which has its own messages to get ready.
fn uutils_grep() -> i32 {
    if let Err(error) = uucore_for_grep::locale::setup_localization("grep") {
        eprintln!("grep: {error}");
        return 99;
    }
    let code = uu_grep::uumain(uucore_for_grep::args_os());
    let _ = std::io::stdout().flush();
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// A name Misty links but nothing here answers would run the shell instead of failing.
    #[test]
    fn the_list_misty_links_is_exactly_the_tools_here() {
        let linked: BTreeSet<&str> = NAMES.iter().copied().collect();
        let here: BTreeSet<&str> = COREUTILS.iter().chain(OTHERS).copied().chain(["sh", "bash"]).collect();
        assert_eq!(linked, here);
        assert_eq!(linked.len(), NAMES.len(), "a name is listed twice");
    }
}

