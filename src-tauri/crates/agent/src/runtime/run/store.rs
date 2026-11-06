//! A run's place on disk, so a run continues after Misty quits and opens again: one JSON file per run
//! under `<data>/runs/`, replaced atomically, readable only by the person's account. The file holds the
//! run's key, needed to sign its calls when it resumes, and goes when the run ends. Model keys are
//! never in it.
//!
//! This is the one place in the crate that touches files directly. The app passes a folder inside
//! `.misty`, which isn't a grant-checked location, so the file gate has nothing to add here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, PoisonError,
    },
};

use serde::{Deserialize, Serialize};

use super::state::LoopState;

/// A saved run. The identity comes first, so a file that can't be read whole still says whose it is.
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct StoredRun {
    pub(crate) version: u32,
    pub(crate) misty_run_id: String,
    pub(crate) runtime_run_id: String,
    pub(crate) control_plane_url: String,
    pub(crate) run_key: String,
    /// The context the server sent, as text, with the device's choices it started on.
    #[serde(default)]
    pub(crate) context: Option<String>,
    #[serde(default)]
    pub(crate) state: Option<LoopState>,
}

pub(crate) const STORE_VERSION: u32 = 1;

/// What can be told of a file that didn't read: who it belongs to, for reporting the failure. No
/// `Debug`, which could print the key.
#[derive(Default)]
pub(crate) struct UnreadableRun {
    pub(crate) misty_run_id: String,
    pub(crate) runtime_run_id: Option<String>,
    pub(crate) control_plane_url: Option<String>,
    pub(crate) run_key: Option<String>,
}

pub(crate) enum LoadedRun {
    Ready(Box<StoredRun>),
    Unreadable(UnreadableRun),
}

pub(crate) struct RunStore {
    folder: PathBuf,
    temp: AtomicU64,
    // Once the runtime closes nothing is written, so a late save can't undo a newer runtime's.
    closed: AtomicBool,
    // Held for each write. Runs whose files went: a save still under way can't bring one back, with
    // its key in it.
    gone: Mutex<HashSet<String>>,
}

/// One top-level text field, read from the head of a file that may be cut off or garbled.
fn head_field(text: &str, name: &str) -> Option<String> {
    let start = text.find(&format!("\"{name}\":\""))? + name.len() + 4;
    let end = text[start..].find('"')? + start;
    Some(text[start..end].to_owned()).filter(|value| !value.is_empty())
}

impl RunStore {
    /// `data` is a folder inside `.misty`.
    pub(crate) fn open(data: &Path) -> io::Result<Self> {
        let folder = data.join("runs");
        fs::create_dir_all(&folder)?;
        restrict(&folder, 0o700)?;
        // Temp files here are from a save that never finished, and nothing is saving yet.
        for entry in fs::read_dir(&folder)?.flatten() {
            if entry.file_name().to_string_lossy().ends_with(".tmp") {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(Self { folder, temp: AtomicU64::new(0), closed: AtomicBool::new(false), gone: Mutex::default() })
    }

    fn path_of(&self, run_id: &str) -> PathBuf {
        self.folder.join(format!("{run_id}.json"))
    }

    /// Replaces the run's file: a temp file, flushed, then a rename, so a crash leaves the old file
    /// or the new one and never half of either.
    pub(crate) fn save(&self, run: &StoredRun) -> io::Result<()> {
        let text = serde_json::to_vec(run)?;
        let gone = self.gone.lock().unwrap_or_else(PoisonError::into_inner);
        if self.closed.load(Ordering::SeqCst) || gone.contains(&run.misty_run_id) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "the run's file is closed"));
        }
        let number = self.temp.fetch_add(1, Ordering::Relaxed);
        let temp = self.folder.join(format!(".{}.{number}.tmp", run.misty_run_id));
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        owner_only(&mut options);
        let written = options.open(&temp).and_then(|mut file| {
            file.write_all(&text)?;
            file.sync_all()
        });
        let moved = written.and_then(|()| fs::rename(&temp, self.path_of(&run.misty_run_id)));
        if moved.is_err() {
            let _ = fs::remove_file(&temp);
        }
        moved?;
        // The rename itself lasts only once its folder is flushed. Windows can't open a folder this way.
        if let Ok(folder) = File::open(&self.folder) {
            let _ = folder.sync_all();
        }
        Ok(())
    }

    /// No more saves after this, and any under way has reached the disk when it returns.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        drop(self.gone.lock().unwrap_or_else(PoisonError::into_inner));
    }

    pub(crate) fn delete(&self, run_id: &str) -> io::Result<()> {
        self.gone.lock().unwrap_or_else(PoisonError::into_inner).insert(run_id.to_owned());
        match fs::remove_file(self.path_of(run_id)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }

    /// Every run left on disk.
    pub(crate) fn load_all(&self) -> io::Result<Vec<LoadedRun>> {
        let mut runs = Vec::new();
        for entry in fs::read_dir(&self.folder)? {
            let path = entry?.path();
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("").to_owned();
            let Some(run_id) = name.strip_suffix(".json").map(str::to_owned) else {
                continue;
            };
            runs.push(Self::load_one(&path, run_id));
        }
        Ok(runs)
    }

    fn load_one(path: &Path, run_id: String) -> LoadedRun {
        let bytes = fs::read(path).unwrap_or_default();
        if let Ok(run) = serde_json::from_slice::<StoredRun>(&bytes) {
            if run.version == STORE_VERSION && run.misty_run_id == run_id {
                return LoadedRun::Ready(Box::new(run));
            }
        }
        let text = String::from_utf8_lossy(&bytes);
        LoadedRun::Unreadable(UnreadableRun {
            misty_run_id: run_id,
            runtime_run_id: head_field(&text, "runtime_run_id"),
            control_plane_url: head_field(&text, "control_plane_url"),
            run_key: head_field(&text, "run_key"),
        })
    }
}

#[cfg(unix)]
fn owner_only(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn owner_only(_: &mut OpenOptions) {}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict(_: &Path, _: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("misty-store-{name}-{}-{}", std::process::id(), rand::random::<u32>()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn run(id: &str) -> StoredRun {
        StoredRun { version: STORE_VERSION, misty_run_id: id.into(), runtime_run_id: "wrun_1".into(), control_plane_url: "http://localhost:1".into(), run_key: "key".into(), context: None, state: None }
    }

    #[test]
    fn a_saved_run_reads_back_and_goes_when_deleted() {
        let data = folder("save");
        let store = RunStore::open(&data).unwrap();
        store.save(&run("run_a")).unwrap();
        store.save(&run("run_a")).unwrap();
        let loaded = store.load_all().unwrap();
        assert_eq!(loaded.len(), 1);
        assert!(matches!(&loaded[0], LoadedRun::Ready(found) if found.misty_run_id == "run_a"));
        store.delete("run_a").unwrap();
        store.delete("run_a").unwrap();
        assert!(store.load_all().unwrap().is_empty());
        // A save that was on its way when the run ended doesn't bring the file back.
        assert!(store.save(&run("run_a")).is_err());
        assert!(store.load_all().unwrap().is_empty());
        fs::remove_dir_all(data).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn only_the_owner_can_read_a_run() {
        use std::os::unix::fs::PermissionsExt;
        let data = folder("mode");
        let store = RunStore::open(&data).unwrap();
        store.save(&run("run_a")).unwrap();
        let file = fs::metadata(data.join("runs/run_a.json")).unwrap().permissions().mode();
        assert_eq!(file & 0o777, 0o600);
        assert_eq!(fs::metadata(data.join("runs")).unwrap().permissions().mode() & 0o777, 0o700);
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_broken_file_still_says_whose_it_is() {
        let data = folder("broken");
        let store = RunStore::open(&data).unwrap();
        let whole = serde_json::to_string(&run("run_b")).unwrap();
        let cut = &whole[..whole.len() - 12];
        fs::write(data.join("runs/run_b.json"), cut).unwrap();
        fs::write(data.join("runs/run_c.json"), "not json").unwrap();
        fs::write(data.join("runs/.run_d.0.tmp"), "half").unwrap();
        let store = RunStore::open(&data).unwrap_or(store);
        let mut loaded = store.load_all().unwrap();
        loaded.sort_by_key(|run| match run {
            LoadedRun::Ready(run) => run.misty_run_id.clone(),
            LoadedRun::Unreadable(run) => run.misty_run_id.clone(),
        });
        let [LoadedRun::Unreadable(cut), LoadedRun::Unreadable(garbled)] = loaded.as_slice() else {
            panic!("both files are unreadable");
        };
        assert_eq!(cut.run_key.as_deref(), Some("key"));
        assert_eq!(cut.runtime_run_id.as_deref(), Some("wrun_1"));
        assert_eq!(garbled.run_key, None);
        assert!(!data.join("runs/.run_d.0.tmp").exists());
        fs::remove_dir_all(data).unwrap();
    }
}
