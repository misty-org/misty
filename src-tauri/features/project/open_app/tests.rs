// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use super::*;

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[test]
    fn explorer_select_argument_quotes_the_path_for_explorer() {
        assert_eq!(
            explorer_select_arg("S:\\Work\\Sublime Text 4\\patch.zip"),
            "/select,\"S:\\Work\\Sublime Text 4\\patch.zip\""
        );
        assert_eq!(
            explorer_select_arg("C:\\tmp\\a.zip"),
            "/select,\"C:\\tmp\\a.zip\""
        );
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_tests {
    use super::*;

    #[tokio::test]
    async fn a_cold_start_does_not_wait_for_the_ide_to_quit() {
        let mut command = tokio::process::Command::new("/bin/sleep");
        command.arg("3");
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(2500),
            start_launcher(command),
        )
        .await;
        assert_eq!(result.unwrap(), Ok(()));
    }

    #[tokio::test]
    async fn a_launcher_failure_is_reported() {
        let command = tokio::process::Command::new("/usr/bin/false");
        assert!(start_launcher(command)
            .await
            .unwrap_err()
            .contains("exit code 1"));
    }

    #[test]
    fn jetbrains_gets_its_own_launcher_arguments() {
        let launcher = Path::new("/Applications/IntelliJ IDEA.app/Contents/MacOS/idea");
        let path = Path::new("/Users/example/My Project/a file.java");
        let command = macos_open_command(
            "IntelliJ IDEA",
            Some(launcher),
            path,
            &["--line".into(), "12".into()],
        );
        let command = command.as_std();
        assert_eq!(command.get_program(), launcher.as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec!["--line", "12", "/Users/example/My Project/a file.java"]
        );
    }

    #[test]
    fn other_apps_open_through_launch_services() {
        let command = macos_open_command(
            "Visual Studio Code",
            None,
            Path::new("/Users/example/My Project"),
            &["--reuse-window".into()],
        );
        let command = command.as_std();
        assert_eq!(command.get_program(), "/usr/bin/open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                "-a",
                "Visual Studio Code",
                "/Users/example/My Project",
                "--args",
                "--reuse-window"
            ]
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_preset_is_found_by_its_id() {
        for id in [
            "vscode", "cursor", "idea", "webstorm", "zed", "sublime", "xcode", "finder",
        ] {
            assert_eq!(preset(id).map(|p| p.id), Some(id));
        }
        assert!(preset("sh").is_none());
        assert!(preset("").is_none());
    }

    #[test]
    fn added_programs_are_kept_in_a_row_windows_cannot_reach() {
        assert!(settings::profile_store::is_protected_scope(PROGRAMS_SCOPE));
        let directory = tempfile::tempdir().unwrap();
        let store = database::store::Store::at(directory.path().join("misty.db"));
        assert!(read_programs(&store).unwrap().programs.is_empty());
        let saved = Programs {
            programs: vec![CustomProgram {
                id: "1".into(),
                name: "Notes".into(),
                path: "/Applications/Notes.app".into(),
            }],
        };
        write_programs(&store, &saved).unwrap();
        write_programs(&store, &saved).unwrap();
        assert_eq!(read_programs(&store).unwrap().programs, saved.programs);
    }

    #[test]
    fn program_names_drop_the_ending() {
        assert_eq!(program_name(Path::new("/Applications/Nova.app")), "Nova");
        assert_eq!(
            program_name(Path::new("C:\\Tools\\notepad++.exe")),
            "C:\\Tools\\notepad++"
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\work")),
            PathBuf::from(r"C:\work")
        );
    }
}
