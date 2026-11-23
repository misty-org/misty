use std::path::Path;

use file_access::disk::{fs_disk, walk};
use file_access::Access;
use serde_json::{json, Value};

use super::{optional, path_list, text};
use crate::files::{
    agent_paths::{admit, admit_path},
    archive::{free_name, pack, unpack_zip, Limits, Naming, Unpacker},
    display_name, failed, gated,
    progress::Stop,
};

const ENTRIES_MOST: usize = 100_000;
const BYTES_MOST: u64 = 8 << 30;

fn agent_dir(path: &Path) -> Result<file_access::disk::CheckedDir, String> {
    gated::dir(path, Access::Write, walk::WalkFor::Agent).map_err(|error| failed(path, error))
}

pub(super) fn zip(input: &Value) -> Result<Value, String> {
    let sources = path_list(input, "paths")?
        .iter()
        .map(|path| admit(path, Access::Read))
        .collect::<Result<Vec<_>, String>>()?;
    let first = &sources[0];
    let target = match optional(input, "to") {
        Some(to) => {
            let target = admit(to, Access::Write)?;
            if !display_name(&target).to_lowercase().ends_with(".zip") {
                return Err("The archive's name ends in .zip.".into());
            }
            target
        }
        None => {
            let folder = first
                .parent()
                .ok_or("That item has no folder to zip into.")?;
            let name = if sources.len() == 1 {
                format!("{}.zip", display_name(first))
            } else {
                "Archive.zip".to_owned()
            };
            admit_path(&folder.join(name), Access::Write)?
        }
    };
    let (folder, name) = gated::split(&target).map_err(|error| failed(&target, error))?;
    let dir = agent_dir(folder)?;
    let name = name.to_string_lossy().into_owned();
    let naming = if optional(input, "to").is_some() {
        Naming::Exact(&name)
    } else {
        Naming::KeepBoth(&name)
    };
    let stop = Stop::default();
    let (archive, tally) = pack(
        &sources,
        &dir,
        naming,
        walk::WalkFor::Agent,
        &stop,
        &mut |_, _| {},
    )
    .map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("{} is there already.", display_name(&target))
        } else {
            failed(&target, error)
        }
    })?;
    Ok(json!({
        "archive": archive.display().to_string(),
        "files": tally.files,
        "skipped": tally.skipped,
    }))
}

pub(super) fn extract(input: &Value) -> Result<Value, String> {
    let archive = admit(text(input, "path")?, Access::Read)?;
    let name = display_name(&archive);
    if !name.to_lowercase().ends_with(".zip") {
        return Err("Only zip archives can be unpacked here.".into());
    }
    let into = match optional(input, "to") {
        Some(to) => admit(to, Access::Write)?,
        None => {
            let folder = archive
                .parent()
                .ok_or("That archive has no folder to unpack into.")?;
            let stem = name
                .get(..name.len() - 4)
                .filter(|stem| !stem.is_empty())
                .unwrap_or("Archive");
            admit_path(&free_name(folder, stem), Access::Write)?
        }
    };
    match fs_disk::symlink_metadata(&into) {
        Ok(meta) if !meta.is_dir() => {
            return Err(format!(
                "{} is there already, and it isn't a folder.",
                display_name(&into)
            ))
        }
        Ok(_) => {}
        Err(_) => {
            let (folder, made) = gated::split(&into).map_err(|error| failed(&into, error))?;
            agent_dir(folder)?
                .create_dir(made)
                .map_err(|error| failed(&into, error))?;
        }
    }
    let root = agent_dir(&into)?;
    let file = gated::open_read_for(&archive, walk::WalkFor::Agent)
        .map_err(|error| failed(&archive, error))?;
    let room = Limits::for_folder(&into);
    let limits = Limits {
        bytes: room.bytes.min(BYTES_MOST),
        entries: ENTRIES_MOST,
    };
    let stop = Stop::default();
    let mut progress = |_: u64, _: &str| {};
    let mut unpacker = Unpacker::new(&root, limits, &stop, &mut progress);
    let unpacked = unpack_zip(file, &mut unpacker);
    let tally = std::mem::take(&mut unpacker.tally);
    unpacked.map_err(|error| failed(&archive, error))?;
    Ok(json!({
        "folder": into.display().to_string(),
        "files": tally.files,
        "skipped": tally.skipped,
    }))
}
