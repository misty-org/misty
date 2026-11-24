#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::{Path, PathBuf};

use super::maker_builds;
use super::routes::{self, Route};
use crate::engines::support::paths::InstallRoot;

struct Scratch {
    dir: PathBuf,
    root: InstallRoot,
}

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("misty-install-home-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();
        let root = InstallRoot::at(dir.join(".misty").join("engines"));
        Self { dir, root }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn write_program(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "#!/bin/sh\necho 1.0.0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn engines_and_node_install_into_mistys_folder() {
    let home = Scratch::new();
    let root = &home.root;
    let misty = home.dir.join(".misty");
    assert_eq!(root.engine_dir("codex"), misty.join("engines/codex"));
    assert_eq!(
        root.program_dirs("codex"),
        vec![
            misty.join("engines/codex/bin"),
            misty.join("engines/codex/node_modules/.bin")
        ]
    );
    assert_eq!(root.node_dir(), misty.join("runtime/node"));
    if !cfg!(windows) {
        assert_eq!(root.node_bin_dir(), misty.join("runtime/node/bin"));
    }
    let args = routes::npm_prefix_args(&root.engine_dir("codex"), "@openai/codex");
    assert_eq!(
        &args[..3],
        [
            "install",
            "--prefix",
            &*misty.join("engines/codex").to_string_lossy()
        ]
    );
    assert!(!args.iter().any(|arg| arg == "-g" || arg == "--global"));
    assert_eq!(args.last().unwrap(), "@openai/codex@latest");
    let claude = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    assert_eq!(
        maker_builds::program_path_in(root, "claude"),
        misty.join("engines/claude/bin").join(claude)
    );
    for engine in crate::engines::support::config::ENGINES {
        assert!(!engine.ends_with("-staging"), "{engine}");
    }
}

#[test]
fn makers_scripts_update_a_copy_they_put_on_the_computer_where_it_is() {
    let (program, args, env) = routes::script_argv("codex", false);
    assert!(program.ends_with("bash"), "{program}");
    assert_eq!(args[0], "-c");
    assert_eq!(
        args[1],
        "set -o pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | bash"
    );
    assert!(!env
        .iter()
        .any(|(k, _)| k == "CODEX_INSTALL_DIR" || k == "HOME"));
    let (program, args, _) = routes::script_argv("agy", true);
    assert!(program.ends_with("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
    assert!(!args.iter().any(|arg| arg.contains("Bypass")));
    assert_eq!(
        args.last().unwrap(),
        "irm https://antigravity.google/cli/install.ps1 | iex"
    );
}

#[test]
fn a_missing_engine_always_goes_into_mistys_folder() {
    let fresh = |engine: &str| routes::route(engine, engine, false);
    for engine in ["claude", "codex", "agy"] {
        assert_eq!(fresh(engine), Some(Route::MistyDownload), "{engine}");
    }
    assert_eq!(fresh("misty"), None);
}

#[test]
fn mistys_own_copy_updates_and_removes_the_way_misty_installed_it() {
    let home = Scratch::new();
    let root = &home.root;
    let npm_bin = root.program_dirs("codex")[1].join("codex");
    write_program(&npm_bin);
    let npm_bin = npm_bin.to_string_lossy().into_owned();
    assert!(routes::installed_by_misty_in(root, "codex", &npm_bin));
    assert_eq!(
        routes::route_in(root, "codex", &npm_bin, true),
        Some(Route::MistyNpm)
    );

    let claude = maker_builds::program_path_in(root, "claude");
    write_program(&claude);
    let claude = claude.to_string_lossy().into_owned();
    assert_eq!(
        routes::route_in(root, "claude", &claude, true),
        Some(Route::MistyDownload)
    );
    assert!(!routes::installed_by_misty_in(root, "codex", &claude));

    let elsewhere = home.dir.join(".local/bin/codex");
    write_program(&elsewhere);
    let elsewhere = elsewhere.to_string_lossy().into_owned();
    assert!(!routes::installed_by_misty_in(root, "codex", &elsewhere));
    assert!(routes::remove_in(root, "codex", &elsewhere).is_err());
    assert!(Path::new(&elsewhere).exists());

    routes::remove_in(root, "codex", &npm_bin).unwrap();
    assert!(!root.engine_dir("codex").exists());
    assert!(root.engine_dir("claude").exists());
}

#[test]
fn engines_are_found_in_settings_then_the_computer_then_mistys_folder() {
    let home = Scratch::new();
    let name = format!("misty-find-{}", uuid::Uuid::new_v4().simple());
    let misty_dir = home.root.program_dirs("codex")[0].clone();
    let mistys = misty_dir.join(&name);
    write_program(&mistys);
    let search = crate::engines::resolve::search_path_with(None, std::slice::from_ref(&misty_dir));
    let found = which::which_in(&name, Some(&search), &home.dir).expect("found");
    assert_eq!(std::fs::canonicalize(found).unwrap(), mistys);
    let computer = home.dir.join("computer");
    write_program(&computer.join(&name));
    let both = std::env::join_paths([computer.clone(), misty_dir.clone()]).unwrap();
    assert_eq!(
        which::which_in(&name, Some(&both), &home.dir).unwrap(),
        computer.join(&name)
    );
    let chosen = home.dir.join("chosen").join(&name);
    write_program(&chosen);
    let found =
        crate::engines::resolve::find_cli_binary(&name, Some(&chosen.to_string_lossy())).unwrap();
    assert_eq!(found, chosen);
    let search: Vec<PathBuf> = std::env::split_paths(&search).collect();
    let misty_at = search
        .iter()
        .position(|dir| *dir == misty_dir)
        .expect("Misty's folder is searched");
    assert_eq!(misty_at, search.len() - 1);
    let process_path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&process_path) {
        if let Some(at) = search.iter().position(|seen| *seen == dir) {
            assert!(
                at < misty_at,
                "{} comes after Misty's folder",
                dir.display()
            );
        }
    }
}

fn homes(home: &Scratch) -> super::uninstall::Homes {
    super::uninstall::Homes {
        home: home.dir.clone(),
        codex_home: home.dir.join(".codex"),
    }
}

#[cfg(unix)]
#[test]
fn uninstall_follows_how_each_copy_was_installed_and_leaves_settings() {
    use super::uninstall::{removal_in, Removal};
    use std::os::unix::fs::symlink;
    let home = Scratch::new();
    let (root, homes) = (&home.root, homes(&home));
    let removal =
        |engine: &str, bin: &Path| removal_in(root, &homes, engine, &bin.to_string_lossy(), false);

    let misty = root.program_dirs("codex")[1].join("codex");
    write_program(&misty);
    assert_eq!(removal("codex", &misty), Some(Removal::Misty));

    let prefix = home.dir.join(".nvm/versions/node/v22");
    let package = prefix.join("lib/node_modules/@openai/codex");
    write_program(&package.join("bin/codex.js"));
    let npm_bin = prefix.join("bin/codex");
    std::fs::create_dir_all(npm_bin.parent().unwrap()).unwrap();
    symlink(package.join("bin/codex.js"), &npm_bin).unwrap();
    assert_eq!(
        removal("codex", &npm_bin),
        Some(Removal::Npm {
            prefix: prefix.clone(),
            package: "@openai/codex"
        })
    );

    let brew_prefix = home.dir.join("homebrew");
    write_program(&brew_prefix.join("bin/brew"));
    let cellar = brew_prefix.join("Cellar/codex/1.0.0/libexec/lib/node_modules/x/codex");
    write_program(&cellar);
    let brew_bin = brew_prefix.join("bin/codex");
    symlink(&cellar, &brew_bin).unwrap();
    assert_eq!(
        removal("codex", &brew_bin),
        Some(Removal::Brew {
            brew: brew_prefix.join("bin/brew"),
            name: "codex".into(),
            cask: false
        })
    );

    let versions = home.dir.join(".local/share/claude");
    write_program(&versions.join("versions/2.1.0"));
    let claude = home.dir.join(".local/bin/claude");
    std::fs::create_dir_all(claude.parent().unwrap()).unwrap();
    symlink(versions.join("versions/2.1.0"), &claude).unwrap();
    assert_eq!(
        removal("claude", &claude),
        Some(Removal::Files(vec![claude.clone(), versions.clone()]))
    );

    let standalone = home.dir.join(".codex/packages/standalone");
    write_program(&standalone.join("releases/1/bin/codex"));
    write_program(&standalone.join("releases/1/bin/codex-code-mode-host"));
    let codex = home.dir.join(".local/bin/codex");
    let host = home.dir.join(".local/bin/codex-code-mode-host");
    symlink(standalone.join("releases/1/bin/codex"), &codex).unwrap();
    symlink(
        standalone.join("releases/1/bin/codex-code-mode-host"),
        &host,
    )
    .unwrap();
    assert_eq!(
        removal("codex", &codex),
        Some(Removal::Files(vec![codex.clone(), host, standalone]))
    );

    let stray = home.dir.join("tools/codex");
    write_program(&stray);
    assert_eq!(removal("codex", &stray), None);
    assert_eq!(removal("codex", Path::new("codex")), None);
}
