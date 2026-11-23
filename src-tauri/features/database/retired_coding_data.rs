use super::environment::AppEnvironmentService;
use super::store::Store;
use file_access::fs;
use std::{
    io,
    path::{Path, PathBuf},
};

const FOLDER: &str = "checkpoints";
const DONE_MARK: &str = "retired:coding-checkpoints";

pub fn remove_once_in_background(environment: &AppEnvironmentService) {
    let store = environment.store();
    let misty_dir = environment.misty_dir();
    let started = std::thread::Builder::new()
        .name("retired-coding-data".into())
        .spawn(move || {
            if let Err(error) = remove_once(&store, &misty_dir) {
                eprintln!("Could not remove old coding data: {error}");
            }
        });
    if let Err(error) = started {
        eprintln!("Could not remove old coding data: {error}");
    }
}

fn remove_once(store: &Store, misty_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let already_done: bool = store.connect()?.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings_state WHERE scope = ?1)",
        [DONE_MARK],
        |row| row.get(0),
    )?;
    if already_done {
        return Ok(());
    }
    remove_checkpoints_folder(misty_dir)?;
    store.connect()?.execute(
        "INSERT OR IGNORE INTO settings_state (scope, revision, document) VALUES (?1, 1, 'true')",
        [DONE_MARK],
    )?;
    Ok(())
}

fn remove_checkpoints_folder(misty_dir: &Path) -> io::Result<()> {
    if !misty_dir.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Misty's data folder is not an absolute path",
        ));
    }
    let folder: PathBuf = misty_dir.join(FOLDER);
    match fs::symlink_metadata(&folder) {
        Ok(metadata) if metadata.file_type().is_dir() => fs::remove_dir_all(&folder),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests {
    use super::*;

    fn data_folder() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let misty_dir = directory.path().join(".misty");
        fs::create_dir_all(misty_dir.join("data")).unwrap();
        fs::create_dir_all(misty_dir.join("profiles/checkpoints")).unwrap();
        fs::create_dir_all(misty_dir.join("checkpoints-old")).unwrap();
        fs::write(misty_dir.join("profiles/checkpoints/keep"), "keep").unwrap();
        fs::write(misty_dir.join("checkpoints-old/keep"), "keep").unwrap();
        fs::write(misty_dir.join("data/keep"), "keep").unwrap();
        fs::write(misty_dir.join("checkpoints.json"), "keep").unwrap();
        (directory, misty_dir)
    }

    fn assert_neighbours_kept(misty_dir: &Path) {
        for kept in [
            "profiles/checkpoints/keep",
            "checkpoints-old/keep",
            "data/keep",
            "checkpoints.json",
        ] {
            assert!(misty_dir.join(kept).is_file(), "{kept} is kept");
        }
    }

    fn store_in(misty_dir: &Path) -> Store {
        Store::in_home(misty_dir)
    }

    fn fill_checkpoints(misty_dir: &Path) {
        let nested = misty_dir.join(FOLDER).join("run-1/files");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("snapshot"), "old").unwrap();
    }

    #[test]
    fn removes_the_folder_with_its_contents_and_nothing_else() {
        let (_directory, misty_dir) = data_folder();
        fill_checkpoints(&misty_dir);
        remove_once(&store_in(&misty_dir), &misty_dir).unwrap();
        assert!(!misty_dir.join(FOLDER).exists());
        assert_neighbours_kept(&misty_dir);
    }

    #[test]
    fn nothing_to_remove_is_not_a_failure() {
        let (_directory, misty_dir) = data_folder();
        remove_once(&store_in(&misty_dir), &misty_dir).unwrap();
        assert_neighbours_kept(&misty_dir);
    }

    #[test]
    fn runs_only_once() {
        let (_directory, misty_dir) = data_folder();
        let store = store_in(&misty_dir);
        remove_once(&store, &misty_dir).unwrap();
        fill_checkpoints(&misty_dir);
        remove_once(&store, &misty_dir).unwrap();
        assert!(misty_dir
            .join(FOLDER)
            .join("run-1/files/snapshot")
            .is_file());
    }

    #[test]
    fn leaves_a_file_with_that_name() {
        let (_directory, misty_dir) = data_folder();
        fs::write(misty_dir.join(FOLDER), "a file").unwrap();
        remove_once(&store_in(&misty_dir), &misty_dir).unwrap();
        assert!(misty_dir.join(FOLDER).is_file());
        assert_neighbours_kept(&misty_dir);
    }

    #[test]
    fn refuses_a_relative_data_folder() {
        let error = remove_checkpoints_folder(Path::new(".misty")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(remove_checkpoints_folder(Path::new("")).is_err());
    }

    #[test]
    fn a_database_that_will_not_open_removes_nothing_and_only_reports() {
        let (_directory, misty_dir) = data_folder();
        fill_checkpoints(&misty_dir);
        let store = Store::at(misty_dir.join("checkpoints.json/misty.db"));
        assert!(remove_once(&store, &misty_dir).is_err());
        assert!(misty_dir
            .join(FOLDER)
            .join("run-1/files/snapshot")
            .is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_will_not_delete_is_tried_again_next_launch() {
        use std::os::unix::fs::PermissionsExt;
        let (_directory, misty_dir) = data_folder();
        fill_checkpoints(&misty_dir);
        let store = store_in(&misty_dir);
        let locked = misty_dir.join(FOLDER).join("run-1");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).unwrap();
        let first = remove_once(&store, &misty_dir);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(first.is_err());
        assert!(misty_dir.join(FOLDER).exists());
        remove_once(&store, &misty_dir).unwrap();
        assert!(!misty_dir.join(FOLDER).exists());
        assert_neighbours_kept(&misty_dir);
    }

    #[cfg(unix)]
    #[test]
    fn leaves_a_symlink_and_what_it_points_to() {
        let (directory, misty_dir) = data_folder();
        let outside = directory.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("precious"), "keep").unwrap();
        std::os::unix::fs::symlink(&outside, misty_dir.join(FOLDER)).unwrap();
        remove_once(&store_in(&misty_dir), &misty_dir).unwrap();
        assert!(fs::symlink_metadata(misty_dir.join(FOLDER))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(outside.join("precious").is_file());
        assert_neighbours_kept(&misty_dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_folder_is_not_followed() {
        let (directory, misty_dir) = data_folder();
        let outside = directory.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("precious"), "keep").unwrap();
        fill_checkpoints(&misty_dir);
        std::os::unix::fs::symlink(&outside, misty_dir.join(FOLDER).join("link")).unwrap();
        remove_once(&store_in(&misty_dir), &misty_dir).unwrap();
        assert!(!misty_dir.join(FOLDER).exists());
        assert!(outside.join("precious").is_file());
        assert_neighbours_kept(&misty_dir);
    }
}
