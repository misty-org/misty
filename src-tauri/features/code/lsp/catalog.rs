//! The language servers Misty knows. A window only ever names one of these by its id; which
//! program runs, from where and with which arguments, is decided here and nowhere else.

/// A language the Code page has a server for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Language {
    TypeScript,
    Python,
    Rust,
    Go,
}

/// Every language, in a fixed order (an index into per-language tables).
pub(super) const ALL: [Language; 4] = [
    Language::TypeScript,
    Language::Python,
    Language::Rust,
    Language::Go,
];

/// What Misty says when gopls is wanted and there is no Go to build or run it with.
pub(super) const GO_MISSING: &str = "Install Go to get Go language support.";

/// Where a server comes from and how it is installed.
pub(super) enum Source {
    /// npm packages installed side by side. `package`'s `bin` entry is the server, run with Node.
    Npm {
        packages: &'static [&'static str],
        package: &'static str,
        bin: &'static str,
    },
    /// A gzipped program attached to each GitHub release, one per system.
    GithubGz {
        repo: &'static str,
        program: &'static str,
    },
    /// Built from source with `go install`.
    GoInstall {
        module: &'static str,
        program: &'static str,
    },
}

impl Language {
    pub(super) fn from_id(id: &str) -> Result<Self, String> {
        ALL.into_iter()
            .find(|language| language.id() == id)
            .ok_or_else(|| "Misty has no language server for that language.".to_string())
    }

    /// The id the window uses, and the key in installed.json.
    pub(super) fn id(self) -> &'static str {
        match self {
            Language::TypeScript => "typescript",
            Language::Python => "python",
            Language::Rust => "rust",
            Language::Go => "go",
        }
    }

    pub(super) fn index(self) -> usize {
        match self {
            Language::TypeScript => 0,
            Language::Python => 1,
            Language::Rust => 2,
            Language::Go => 3,
        }
    }

    /// The server's own name, as installing and errors show it.
    pub(super) fn server(self) -> &'static str {
        match self {
            Language::TypeScript => "typescript-language-server",
            Language::Python => "basedpyright",
            Language::Rust => "rust-analyzer",
            Language::Go => "gopls",
        }
    }

    pub(super) fn source(self) -> Source {
        match self {
            Language::TypeScript => Source::Npm {
                // The server drives the compiler's own tsserver, so both come together.
                packages: &["typescript-language-server", "typescript"],
                package: "typescript-language-server",
                bin: "typescript-language-server",
            },
            Language::Python => Source::Npm {
                packages: &["basedpyright"],
                package: "basedpyright",
                bin: "basedpyright-langserver",
            },
            Language::Rust => Source::GithubGz {
                repo: "rust-lang/rust-analyzer",
                program: "rust-analyzer",
            },
            Language::Go => Source::GoInstall {
                module: "golang.org/x/tools/gopls",
                program: "gopls",
            },
        }
    }

    /// What the server is told on its command line. Each of them speaks LSP over stdio.
    pub(super) fn args(self) -> &'static [&'static str] {
        match self {
            Language::TypeScript | Language::Python => &["--stdio"],
            Language::Rust | Language::Go => &[],
        }
    }

    /// The files that mark a project's top folder, nearest first.
    pub(super) fn root_markers(self) -> &'static [&'static str] {
        match self {
            Language::TypeScript => &["tsconfig.json", "jsconfig.json", "package.json"],
            Language::Python => &[
                "pyproject.toml",
                "setup.cfg",
                "setup.py",
                "pyrightconfig.json",
            ],
            Language::Rust => &["Cargo.toml"],
            Language::Go => &["go.mod"],
        }
    }
}

/// A program's file name on this system.
pub(super) fn program_file(program: &str) -> String {
    if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    }
}

/// rust-analyzer's release asset for this system, or nothing where it isn't built.
pub(super) fn rust_analyzer_asset(os: &str, arch: &str) -> Option<String> {
    let arch = match arch {
        "aarch64" | "x86_64" => arch,
        _ => return None,
    };
    let target = match os {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => return None,
    };
    Some(format!("rust-analyzer-{arch}-{target}.gz"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_ids_name_a_language() {
        for language in ALL {
            assert_eq!(Language::from_id(language.id()), Ok(language));
            assert_eq!(ALL[language.index()], language);
        }
        assert!(Language::from_id("/bin/sh").is_err());
        assert!(Language::from_id("").is_err());
    }

    #[test]
    fn rust_analyzer_has_an_asset_for_each_desktop() {
        assert_eq!(
            rust_analyzer_asset("macos", "aarch64").as_deref(),
            Some("rust-analyzer-aarch64-apple-darwin.gz")
        );
        assert_eq!(
            rust_analyzer_asset("linux", "x86_64").as_deref(),
            Some("rust-analyzer-x86_64-unknown-linux-gnu.gz")
        );
        assert_eq!(
            rust_analyzer_asset("windows", "x86_64").as_deref(),
            Some("rust-analyzer-x86_64-pc-windows-msvc.gz")
        );
        assert_eq!(rust_analyzer_asset("freebsd", "x86_64"), None);
    }
}
