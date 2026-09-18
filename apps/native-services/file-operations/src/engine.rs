use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use cap_std::fs::{
    Dir, DirBuilder, DirBuilderExt, Metadata, MetadataExt, OpenOptions, OpenOptionsExt,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::{
    collections::HashSet,
    ffi::{CStr, CString, OsStr, OsString},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, RawFd},
        unix::ffi::OsStrExt,
    },
    path::PathBuf,
};

struct Control {
    cancel: Arc<AtomicBool>,
    state: Arc<Mutex<Value>>,
    last_progress: Mutex<std::time::Instant>,
}
impl Control {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Acquire) {
            Err("Transfer cancelled because its job, folder grant, or App closed.".into())
        } else {
            Ok(())
        }
    }
    fn progress(&self, bytes: u64, files: u64) -> Result<(), String> {
        self.check()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Transfer status unavailable.")?;
        for (key, add) in [("bytes", bytes), ("files", files)] {
            let value = state[key]
                .as_u64()
                .unwrap_or(0)
                .checked_add(add)
                .filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or("Transfer exceeds supported progress range.")?;
            state[key] = json!(value);
        }
        if let Ok(mut last) = self.last_progress.lock() {
            if last.elapsed() >= std::time::Duration::from_millis(100) {
                // Private scratch output, bounded independently from the final response.
                let _ = std::fs::write("progress.json", state.to_string());
                *last = std::time::Instant::now();
            }
        }
        Ok(())
    }
    fn result(&self, name: &OsStr, kind: &str, removed: bool) -> Result<Value, String> {
        let result = json!({"entry":encode_name(name),"name":name.to_string_lossy(),"kind":kind,"sourceRemoved":removed});
        self.state
            .lock()
            .map_err(|_| "Transfer status unavailable.")?["result"] = result.clone();
        Ok(result)
    }
}

fn encode_name(name: &OsStr) -> String {
    format!("u:{}", URL_SAFE_NO_PAD.encode(name.as_bytes()))
}
fn decode_name(token: &str) -> Result<OsString, String> {
    use std::os::unix::ffi::OsStringExt;
    let bytes = URL_SAFE_NO_PAD
        .decode(token.strip_prefix("u:").ok_or("Invalid entry.")?)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty()
        || bytes.len() > 4096
        || bytes.contains(&0)
        || bytes.contains(&b'/')
        || bytes == b"."
        || bytes == b".."
    {
        return Err("Invalid entry.".into());
    }
    Ok(OsString::from_vec(bytes))
}
pub fn execute(request: Value, cancel: Arc<AtomicBool>) -> Result<Value, String> {
    use std::os::{
        fd::FromRawFd,
        unix::fs::{FileExt, MetadataExt as StdMetadataExt},
    };
    let state = Arc::new(Mutex::new(json!({"bytes":0,"files":0,"result":null})));
    let control = Control {
        cancel,
        state: state.clone(),
        last_progress: Mutex::new(std::time::Instant::now()),
    };
    let to = unsafe { crate::runtime::directory(101) };
    let name = decode_name(request["entry"].as_str().ok_or("Missing entry.")?)?;
    let conflicts = request["rename"].as_bool().unwrap_or(false);
    if request["prepared"] == true {
        let file = unsafe { std::fs::File::from_raw_fd(100) };
        let metadata = file.metadata().map_err(failure)?;
        let original = (
            metadata.len(),
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec(),
        );
        (|| -> Result<(), String> {
            control.check()?;
            let stage = OsString::from(format!(".misty-transfer-{}", uuid::Uuid::new_v4()));
            to.create_dir_with(&stage, DirBuilder::new().mode(0o700))
                .map_err(failure)?;
            let staging = to.open_dir(&stage).map_err(failure)?;
            let stage_identity = identity(&staging.dir_metadata().map_err(failure)?);
            let copied = (|| {
                let mut output = staging
                    .open_with(
                        "entry",
                        OpenOptions::new().write(true).create_new(true).mode(0o600),
                    )
                    .map_err(failure)?;
                let mut offset = 0;
                let mut bytes = vec![0; 64 * 1024];
                while offset < original.0 {
                    control.check()?;
                    let length = bytes.len().min((original.0 - offset) as usize);
                    file.read_exact_at(&mut bytes[..length], offset)
                        .map_err(failure)?;
                    output.write_all(&bytes[..length]).map_err(failure)?;
                    offset += length as u64;
                    control.progress(length as u64, 0)?;
                }
                let metadata = file.metadata().map_err(failure)?;
                if original
                    != (
                        metadata.len(),
                        metadata.mtime(),
                        metadata.mtime_nsec(),
                        metadata.ctime(),
                        metadata.ctime_nsec(),
                    )
                {
                    return Err("Source file changed while copying.".into());
                }
                metadata_copy(file.as_raw_fd(), output.as_raw_fd())?;
                output.flush().map_err(failure)?;
                control.progress(0, 1)?;
                let target = publish(
                    &staging,
                    OsStr::new("entry"),
                    &to,
                    &name,
                    conflicts,
                    &control,
                )?;
                control.result(&target, "file", false)?;
                Ok(())
            })();
            let cleanup = cleanup_stage(&to, &stage, stage_identity);
            match copied {
                Ok(()) => cleanup,
                Err(error) => Err(with_cleanup_error(error, cleanup)),
            }
        })()?;
    } else {
        let from = unsafe { crate::runtime::directory(100) };
        transfer(
            &from,
            &name,
            &to,
            request["moving"].as_bool().unwrap_or(false),
            conflicts,
            &control,
        )?;
    }
    let result = state.lock().map_err(|_| "Status unavailable.")?.clone();
    Ok(result)
}
fn failure(error: std::io::Error) -> String {
    format!("File transfer failed: {error}")
}
#[derive(Clone, PartialEq, Eq)]
struct Fingerprint {
    dev: u64,
    ino: u64,
    size: u64,
    modified: (i64, i64),
    changed: (i64, i64),
    mode: u32,
}
fn fingerprint(m: &Metadata) -> Fingerprint {
    Fingerprint {
        dev: m.dev(),
        ino: m.ino(),
        size: m.len(),
        modified: (m.mtime(), m.mtime_nsec()),
        changed: (m.ctime(), m.ctime_nsec()),
        mode: m.mode(),
    }
}
fn identity(m: &Metadata) -> (u64, u64) {
    (m.dev(), m.ino())
}
fn granted_path(dir: &Dir) -> Result<PathBuf, String> {
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(dir.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The granted folder moved or became unavailable.".into());
    }
    Ok(PathBuf::from(OsStr::from_bytes(
        unsafe { CStr::from_ptr(bytes.as_ptr()) }.to_bytes(),
    )))
}
fn rename(from: &Dir, name: &OsStr, to: &Dir, target: &OsStr) -> std::io::Result<()> {
    let a = CString::new(name.as_bytes())?;
    let b = CString::new(target.as_bytes())?;
    if unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            a.as_ptr(),
            to.as_raw_fd(),
            b.as_ptr(),
            libc::RENAME_EXCL,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}
fn candidate(name: &OsStr, number: usize) -> OsString {
    if number == 0 {
        return name.to_owned();
    }
    let bytes = name.as_bytes();
    let split = bytes
        .iter()
        .rposition(|b| *b == b'.')
        .filter(|n| *n > 0 && bytes.len() - n <= 32)
        .unwrap_or(bytes.len());
    let suffix = format!(" (copy {number})");
    let mut end = split.min(255 - suffix.len() - (bytes.len() - split));
    if let Ok(text) = std::str::from_utf8(bytes) {
        while !text.is_char_boundary(end) {
            end -= 1;
        }
    }
    let mut result = bytes[..end].to_vec();
    result.extend_from_slice(suffix.as_bytes());
    result.extend_from_slice(&bytes[split..]);
    OsStr::from_bytes(&result).to_owned()
}
fn publish(
    from: &Dir,
    stage: &OsStr,
    to: &Dir,
    desired: &OsStr,
    conflicts: bool,
    control: &Control,
) -> Result<OsString, String> {
    for number in 0..if conflicts { 1000 } else { 1 } {
        control.check()?;
        let name = candidate(desired, number);
        match rename(from, stage, to, &name) {
            Ok(()) => return Ok(name),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && conflicts => {}
            Err(e) => return Err(failure(e)),
        }
    }
    Err("Too many copies already use this filename.".into())
}
struct Receipt {
    fingerprint: Fingerprint,
    kind: &'static str,
    children: Vec<(OsString, Receipt)>,
}
fn metadata_copy(from: RawFd, to: RawFd) -> Result<(), String> {
    if unsafe { libc::fcopyfile(from, to, std::ptr::null_mut(), libc::COPYFILE_METADATA) } == 0 {
        Ok(())
    } else {
        Err(failure(std::io::Error::last_os_error()))
    }
}
fn copy_entry(
    source: &Dir,
    name: &OsStr,
    destination: &Dir,
    target: &OsStr,
    control: &Control,
    depth: usize,
    count: &mut usize,
    outputs: &mut HashSet<(u64, u64)>,
) -> Result<Receipt, String> {
    control.check()?;
    *count += 1;
    if depth > 256 || *count > 1_000_000 {
        return Err("This transfer exceeds the supported tree size.".into());
    }
    let metadata = source.symlink_metadata(name).map_err(failure)?;
    let before = fingerprint(&metadata);
    let mut children = Vec::new();
    let kind;
    if metadata.is_dir() {
        kind = "directory";
        let input = source.open_dir(name).map_err(failure)?;
        if fingerprint(&input.dir_metadata().map_err(failure)?) != before
            || outputs.contains(&identity(&metadata))
        {
            return Err("A source folder changed or contains the destination.".into());
        }
        destination.create_dir(target).map_err(failure)?;
        let output = destination.open_dir(target).map_err(failure)?;
        outputs.insert(identity(&output.dir_metadata().map_err(failure)?));
        for entry in input.entries().map_err(failure)? {
            control.check()?;
            let name = entry.map_err(failure)?.file_name();
            let receipt = copy_entry(
                &input,
                &name,
                &output,
                &name,
                control,
                depth + 1,
                count,
                outputs,
            )?;
            children.push((name, receipt));
        }
        control.check()?;
        if fingerprint(&input.dir_metadata().map_err(failure)?) != before {
            return Err("Source folder changed while being copied.".into());
        }
        metadata_copy(input.as_raw_fd(), output.as_raw_fd())?;
    } else if metadata.is_file() {
        kind = "file";
        let mut input = source
            .open_with(
                name,
                OpenOptions::new()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK),
            )
            .map_err(failure)?;
        if fingerprint(&input.metadata().map_err(failure)?) != before {
            return Err("Source file changed before copying.".into());
        }
        let mut output = destination
            .open_with(target, OpenOptions::new().write(true).create_new(true))
            .map_err(failure)?;
        let mut buffer = vec![0u8; 512 * 1024];
        loop {
            control.check()?;
            let size = input.read(&mut buffer).map_err(failure)?;
            if size == 0 {
                break;
            }
            control.check()?;
            output.write_all(&buffer[..size]).map_err(failure)?;
            control.progress(size as u64, 0)?;
        }
        control.check()?;
        if fingerprint(&input.metadata().map_err(failure)?) != before {
            return Err("Source file changed while being copied.".into());
        }
        metadata_copy(input.as_raw_fd(), output.as_raw_fd())?;
        output.sync_all().map_err(failure)?;
        control.progress(0, 1)?;
    } else if metadata.is_symlink() {
        kind = "symlink";
        let link = source.read_link_contents(name).map_err(failure)?;
        control.check()?;
        if fingerprint(&source.symlink_metadata(name).map_err(failure)?) != before {
            return Err("Source link changed while being copied.".into());
        }
        destination
            .symlink_contents(link, target)
            .map_err(failure)?;
        control.progress(0, 1)?;
    } else {
        return Err("Special device files cannot be transferred by an App.".into());
    }
    Ok(Receipt {
        fingerprint: before,
        kind,
        children,
    })
}
fn verify(source: &Dir, name: &OsStr, receipt: &Receipt, control: &Control) -> Result<(), String> {
    control.check()?;
    if fingerprint(&source.symlink_metadata(name).map_err(failure)?) != receipt.fingerprint {
        return Err("Source changed after copying; both copies were kept.".into());
    }
    if receipt.kind == "directory" {
        let directory = source.open_dir(name).map_err(failure)?;
        if fingerprint(&directory.dir_metadata().map_err(failure)?) != receipt.fingerprint {
            return Err("Source folder changed after copying; both copies were kept.".into());
        }
        let names = directory
            .entries()
            .map_err(failure)?
            .map(|entry| entry.map(|e| e.file_name()))
            .collect::<std::io::Result<HashSet<_>>>()
            .map_err(failure)?;
        if names.len() != receipt.children.len()
            || receipt
                .children
                .iter()
                .any(|(name, _)| !names.contains(name))
        {
            return Err("Source folder contents changed; both copies were kept.".into());
        }
        for (name, child) in &receipt.children {
            verify(&directory, name, child, control)?;
        }
    }
    Ok(())
}
fn remove_verified(
    source: &Dir,
    name: &OsStr,
    receipt: &Receipt,
    control: &Control,
) -> Result<(), String> {
    control.check()?;
    let current = source.symlink_metadata(name).map_err(failure)?;
    if receipt.kind == "directory" {
        if identity(&current) != (receipt.fingerprint.dev, receipt.fingerprint.ino) {
            return Err("Source folder changed; its destination copy was kept.".into());
        }
        let directory = source.open_dir(name).map_err(failure)?;
        if identity(&directory.dir_metadata().map_err(failure)?) != identity(&current) {
            return Err("Source folder changed before removal.".into());
        }
        for (name, child) in &receipt.children {
            remove_verified(&directory, name, child, control)?;
        }
        control.check()?;
        source.remove_dir(name).map_err(failure)?;
    } else {
        if fingerprint(&current) != receipt.fingerprint {
            return Err("Source file changed; both copies were kept.".into());
        }
        control.check()?;
        source.remove_file(name).map_err(failure)?;
    }
    Ok(())
}
fn transfer(
    source: &Dir,
    name: &OsStr,
    destination: &Dir,
    moving: bool,
    conflicts: bool,
    control: &Control,
) -> Result<(), String> {
    control.check()?;
    let metadata = source.symlink_metadata(name).map_err(failure)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else if metadata.is_symlink() {
        "symlink"
    } else {
        return Err("Special device files cannot be transferred by an App.".into());
    };
    if metadata.is_dir() {
        let source_dir = source.open_dir(name).map_err(failure)?;
        if identity(&source_dir.dir_metadata().map_err(failure)?) != identity(&metadata) {
            return Err("Source folder changed.".into());
        }
        if granted_path(destination)?.starts_with(granted_path(&source_dir)?) {
            return Err("A folder cannot be transferred into itself or its descendants.".into());
        }
    }
    if moving
        && identity(&source.dir_metadata().map_err(failure)?)
            == identity(&destination.dir_metadata().map_err(failure)?)
    {
        control.result(name, kind, false)?;
        return Ok(());
    }
    if moving {
        let mut cross_volume = false;
        for number in 0..if conflicts { 1000 } else { 1 } {
            control.check()?;
            let target = candidate(name, number);
            match rename(source, name, destination, &target) {
                Ok(()) => {
                    control.result(&target, kind, true)?;
                    return Ok(());
                }
                Err(e) if e.raw_os_error() == Some(libc::EXDEV) => {
                    cross_volume = true;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && conflicts => continue,
                Err(e) => return Err(failure(e)),
            }
        }
        if !cross_volume {
            return Err("No available destination name; existing files were kept.".into());
        }
    }
    let stage = OsString::from(format!(".misty-transfer-{}", uuid::Uuid::new_v4()));
    destination
        .create_dir_with(&stage, DirBuilder::new().mode(0o700))
        .map_err(failure)?;
    let staging = destination.open_dir(&stage).map_err(failure)?;
    let stage_identity = identity(&staging.dir_metadata().map_err(failure)?);
    let mut outputs = HashSet::from([identity(&destination.dir_metadata().map_err(failure)?)]);
    outputs.insert(stage_identity);
    let copied = copy_entry(
        source,
        name,
        &staging,
        OsStr::new("entry"),
        control,
        0,
        &mut 0,
        &mut outputs,
    );
    let receipt = match copied {
        Ok(receipt) => receipt,
        Err(error) => {
            return Err(with_cleanup_error(
                error,
                cleanup_stage(destination, &stage, stage_identity),
            ));
        }
    };
    let target = match publish(
        &staging,
        OsStr::new("entry"),
        destination,
        name,
        conflicts,
        control,
    ) {
        Ok(name) => name,
        Err(error) => {
            return Err(with_cleanup_error(
                error,
                cleanup_stage(destination, &stage, stage_identity),
            ));
        }
    };
    control.result(&target, kind, false)?;
    cleanup_stage(destination, &stage, stage_identity)?;
    if moving {
        verify(source, name, &receipt, control)?;
        remove_verified(source, name, &receipt, control)?;
        control.result(&target, kind, true)?;
    }
    Ok(())
}
fn with_cleanup_error(error: String, cleanup: Result<(), String>) -> String {
    match cleanup {
        Ok(()) => error,
        Err(cleanup) => format!("{error} {cleanup}"),
    }
}
fn cleanup_stage(destination: &Dir, name: &OsStr, expected: (u64, u64)) -> Result<(), String> {
    match destination.symlink_metadata(name) {
        Ok(metadata) if metadata.is_dir() && identity(&metadata) == expected => {
            // Copied directory metadata may be read-only. Change only our private
            // staged copy, through retained descriptors, before removing it.
            if let Ok(directory) = open_directory_nofollow(destination, name) {
                if directory.dir_metadata().map(|m| identity(&m)).ok() == Some(expected) {
                    make_staging_removable(&directory, 0);
                }
            }
            destination.remove_dir_all(name).map_err(|error| {
                format!(
                    "A temporary transfer copy could not be removed: {}",
                    failure(error)
                )
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("The temporary transfer folder changed and was left untouched.".into()),
    }
}
fn open_directory_nofollow(parent: &Dir, name: &OsStr) -> std::io::Result<Dir> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
    parent
        .open_with(name, &options)
        .map(|file| Dir::from_std_file(file.into_std()))
}
fn make_staging_removable(directory: &Dir, depth: usize) {
    if depth > 257 {
        return;
    }
    if let Ok(metadata) = directory.dir_metadata() {
        unsafe {
            libc::fchmod(
                directory.as_raw_fd(),
                (metadata.mode() | 0o700) as libc::mode_t,
            );
        }
    }
    if let Ok(entries) = directory.entries() {
        for entry in entries.flatten() {
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                if let Ok(child) = open_directory_nofollow(directory, &entry.file_name()) {
                    make_staging_removable(&child, depth + 1);
                }
            }
        }
    }
}
