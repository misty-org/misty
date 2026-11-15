//! Keeps the engines Misty installed in `~/.misty/shared/engines` at the version this build needs.
//!
//! Every build shares those installs, so a newer build may need a newer engine than the one an
//! older build installed. Before a run starts an engine Misty installed, its version is compared
//! with this build's minimum (`MINIMUMS`) without going to the network: the version found is kept
//! in `shared/engines/versions.json` until the program itself changes. Only an engine below its
//! minimum is updated, by the same route Settings › Engines uses, under a lock so two builds never
//! update it at once. Nothing is ever downgraded, and an engine that was on the computer before
//! Misty is the person's and is never touched.
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use super::{engine_bin, parse_version, probe_local_version, route_for, routes, ProgressReporter};
use crate::engines::support::paths::app_home;

/// The oldest version of each engine this build works with. An adapter adds its engine here when
/// it relies on something an older release of that engine doesn't have.
const MINIMUMS: &[(&str, &str)] = &[];

/// How long another build's update may hold the lock before it counts as abandoned.
const LOCK_STALE: Duration = Duration::from_secs(15 * 60);

/// Brings `engine` up to this build's minimum when Misty installed it and it is older. A failed
/// update is returned; the caller decides whether the run goes ahead with the older engine.
pub(crate) async fn ensure_minimum(engine: &str) -> Result<(), String> {
    let Some(needed) = MINIMUMS
        .iter()
        .find(|(name, _)| *name == engine)
        .and_then(|(_, version)| parse_version(version))
    else {
        return Ok(());
    };
    let bin = engine_bin(engine);
    if !routes::installed_by_misty(engine, &bin) {
        return Ok(());
    }
    if recent_enough(engine, &bin, needed).await {
        return Ok(());
    }
    let Some(_lock) = UpdateLock::take(engine) else {
        // Another build is updating it right now; this run uses what is there.
        return Ok(());
    };
    // That build may have finished between the check and the lock.
    if recent_enough(engine, &bin, needed).await {
        return Ok(());
    }
    let route = route_for(engine, &bin, true)
        .ok_or_else(|| format!("Misty can't update {engine} for you."))?;
    let reporter = ProgressReporter::new(format!("upkeep-{engine}"), engine.to_owned());
    routes::run(engine, route, &bin, &reporter).await?;
    forget(engine);
    Ok(())
}

async fn recent_enough(engine: &str, bin: &str, needed: (u64, u64, u64)) -> bool {
    installed_version(engine, bin)
        .await
        .as_deref()
        .and_then(parse_version)
        .is_some_and(|found| found >= needed)
}

/// The version of the program at `bin`: the one noted in `versions.json` while the program is
/// unchanged, else `<bin> --version`, noted for next time.
async fn installed_version(engine: &str, bin: &str) -> Option<String> {
    let stamp = modified_ms(Path::new(bin));
    let mut noted = read_noted();
    if let Some(entry) = noted.get(engine) {
        if entry["bin"] == bin && stamp.is_some() && entry["modified_ms"].as_u64() == stamp {
            return entry["version"].as_str().map(str::to_owned);
        }
    }
    let version = probe_local_version(bin).await.version?;
    noted.insert(
        engine.to_owned(),
        json!({"bin": bin, "modified_ms": stamp, "version": version}),
    );
    write_noted(&noted);
    Some(version)
}

fn forget(engine: &str) {
    let mut noted = read_noted();
    if noted.remove(engine).is_some() {
        write_noted(&noted);
    }
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = file_access::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn noted_file() -> PathBuf {
    app_home().join("versions.json")
}

fn read_noted() -> Map<String, Value> {
    file_access::fs::read_to_string(noted_file())
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_noted(noted: &Map<String, Value>) {
    let file = noted_file();
    let staging = file.with_extension("json.writing");
    let text = Value::Object(noted.clone()).to_string();
    if file_access::fs::write(&staging, text).is_ok() {
        let _ = file_access::fs::rename(&staging, &file);
    }
}

/// `shared/engines/<engine>.updating`, held while one build updates that engine.
struct UpdateLock(PathBuf);

impl UpdateLock {
    fn take(engine: &str) -> Option<Self> {
        let path = app_home().join(format!("{engine}.updating"));
        let stale = file_access::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|at| SystemTime::now().duration_since(at).ok())
            .is_some_and(|age| age > LOCK_STALE);
        if stale {
            let _ = file_access::fs::remove_file(&path);
        }
        let _ = file_access::fs::create_dir_all(app_home());
        file_access::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .ok()
            .map(|_| Self(path))
    }
}

impl Drop for UpdateLock {
    fn drop(&mut self) {
        let _ = file_access::fs::remove_file(&self.0);
    }
}
