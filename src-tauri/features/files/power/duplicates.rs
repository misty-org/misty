// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Find duplicates: files in a folder with the same contents. Files are grouped by size first,
//! hard links to one file count once, then only files that share a size and their first and last
//! 64 KiB are read whole and hashed with BLAKE3, a few at a time, so most of a folder is never
//! opened. Empty files, links, hidden items and what is inside packages are left out, as Finder
//! hides them.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
};

use file_access::disk::{walk, ItemKind};
use file_access::Access;
use serde::Serialize;

use super::super::entry::is_package_name;
use super::super::gated;
use super::super::progress::{Op, Stop};
use super::failed;

const EDGE: u64 = 64 * 1024;
const HASHERS: usize = 3;
const FILES_MOST: usize = 2_000_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    pub hash: String,
    pub paths: Vec<String>,
}

struct Found {
    path: PathBuf,
    size: u64,
}

fn same_sizes(dir: &Path, stop: &Stop) -> io::Result<BTreeMap<u64, Vec<Found>>> {
    let mut by_size: BTreeMap<u64, Vec<Found>> = BTreeMap::new();
    let mut seen: HashSet<(u64, u64)> = HashSet::new();
    let mut count = 0usize;
    walk::walk(dir, Access::Read, walk::WalkFor::Person, &mut |step| {
        if stop.stopped() {
            return Err(gated::cancelled());
        }
        let name = step.item.name.to_string_lossy();
        if name.starts_with('.') {
            return Ok(walk::WalkFlow::SkipDir);
        }
        match step.item.kind {
            ItemKind::Dir if is_package_name(&name) => Ok(walk::WalkFlow::SkipDir),
            ItemKind::File if step.item.len > 0 => {
                count += 1;
                if count > FILES_MOST {
                    return Ok(walk::WalkFlow::Stop);
                }
                let inode = (step.item.dev, step.item.ino);
                if step.item.ino != 0 && !seen.insert(inode) {
                    return Ok(walk::WalkFlow::Continue);
                }
                by_size.entry(step.item.len).or_default().push(Found {
                    path: step.dir.path().join(&step.item.name),
                    size: step.item.len,
                });
                Ok(walk::WalkFlow::Continue)
            }
            _ => Ok(walk::WalkFlow::Continue),
        }
    })?;
    by_size.retain(|_, found| found.len() > 1);
    Ok(by_size)
}

fn edges(path: &Path, size: u64) -> io::Result<Vec<u8>> {
    let mut file = gated::open_read(path)?;
    let mut bytes = Vec::new();
    (&mut file).take(EDGE).read_to_end(&mut bytes)?;
    if size > EDGE * 2 {
        file.seek(SeekFrom::Start(size - EDGE))?;
        file.take(EDGE).read_to_end(&mut bytes)?;
    }
    Ok(bytes)
}

fn same_edges(groups: BTreeMap<u64, Vec<Found>>, stop: &Stop) -> io::Result<Vec<Vec<Found>>> {
    let mut kept = Vec::new();
    for (size, found) in groups.into_iter().rev() {
        if stop.stopped() {
            return Err(gated::cancelled());
        }
        if size <= EDGE * 2 {
            kept.push(found);
            continue;
        }
        let mut by_edges: HashMap<Vec<u8>, Vec<Found>> = HashMap::new();
        for item in found {
            if let Ok(key) = edges(&item.path, size) {
                by_edges
                    .entry(blake3::hash(&key).as_bytes().to_vec())
                    .or_default()
                    .push(item);
            }
        }
        kept.extend(by_edges.into_values().filter(|found| found.len() > 1));
    }
    Ok(kept)
}

fn hash_file(path: &Path, stop: &Stop, read: &mut dyn FnMut(u64)) -> io::Result<String> {
    let mut file = gated::open_read(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        if stop.stopped() {
            return Err(gated::cancelled());
        }
        let count = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        hasher.update(&buffer[..count]);
        read(count as u64);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

enum Heard {
    Read(u64, String),
    Hashed(usize, Option<String>),
}

fn hash_all(files: &[&Found], op: &mut Op) -> Result<Vec<Option<String>>, String> {
    let stop = op.stop();
    let next = AtomicUsize::new(0);
    let mut hashes: Vec<Option<String>> = vec![None; files.len()];
    let (tell, heard) = mpsc::channel::<Heard>();
    std::thread::scope(|scope| {
        for _ in 0..HASHERS.min(files.len()) {
            let (tell, next, stop) = (tell.clone(), &next, &stop);
            scope.spawn(move || loop {
                let index = next.fetch_add(1, Ordering::SeqCst);
                let Some(item) = files.get(index) else { break };
                if stop.stopped() {
                    break;
                }
                let name = super::display_name(&item.path);
                let hash = hash_file(&item.path, stop, &mut |bytes| {
                    let _ = tell.send(Heard::Read(bytes, name.clone()));
                })
                .ok();
                let _ = tell.send(Heard::Hashed(index, hash));
            });
        }
        drop(tell);
        for message in heard {
            match message {
                Heard::Read(bytes, name) => op.advance(bytes, &name),
                Heard::Hashed(index, hash) => hashes[index] = hash,
            }
        }
    });
    if op.cancelled() {
        return Err("Cancelled.".into());
    }
    Ok(hashes)
}

pub(super) fn find(dir: &Path, op: &mut Op) -> Result<Vec<DuplicateGroup>, String> {
    let stop = op.stop();
    let by_size = same_sizes(dir, &stop).map_err(|error| failed(dir, error))?;
    let candidates = same_edges(by_size, &stop).map_err(|error| failed(dir, error))?;
    let files: Vec<&Found> = candidates.iter().flatten().collect();
    op.set_total(files.iter().map(|item| item.size).sum());
    let hashes = hash_all(&files, op)?;
    let mut groups: BTreeMap<(std::cmp::Reverse<u64>, String), Vec<String>> = BTreeMap::new();
    for (item, hash) in files.iter().zip(hashes) {
        if let Some(hash) = hash {
            groups
                .entry((std::cmp::Reverse(item.size), hash))
                .or_default()
                .push(item.path.display().to_string());
        }
    }
    Ok(groups
        .into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .map(|((size, hash), paths)| DuplicateGroup {
            size: size.0,
            hash,
            paths,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_links_count_once_and_edges_split_lookalikes() {
        let root = tempfile::tempdir().expect("temp folder");
        let dir = root.path();
        let big = |last: u8| {
            let mut bytes = vec![7u8; (EDGE * 3) as usize];
            *bytes.last_mut().expect("bytes") = last;
            bytes
        };
        file_access::fs::write(dir.join("a.bin"), big(1)).expect("write");
        file_access::fs::write(dir.join("b.bin"), big(1)).expect("write");
        file_access::fs::write(dir.join("c.bin"), big(2)).expect("write");
        file_access::fs::write(dir.join("one.txt"), b"same").expect("write");
        std::fs::hard_link(dir.join("one.txt"), dir.join("two.txt")).expect("link");
        let stop = Stop::default();
        let by_size = same_sizes(dir, &stop).expect("sizes");
        assert!(!by_size.contains_key(&4));
        let candidates = same_edges(by_size, &stop).expect("edges");
        assert_eq!(candidates.len(), 1);
        let mut names: Vec<String> = candidates[0]
            .iter()
            .map(|item| super::super::display_name(&item.path))
            .collect();
        names.sort();
        assert_eq!(names, ["a.bin", "b.bin"]);
        let hash = |name: &str| hash_file(&dir.join(name), &stop, &mut |_| {}).expect("hash");
        assert_eq!(hash("a.bin"), hash("b.bin"));
        assert_ne!(hash("a.bin"), hash("c.bin"));
    }
}
