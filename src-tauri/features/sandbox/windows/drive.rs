use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};

use windows_sys::Win32::Storage::FileSystem::{
    DefineDosDeviceW, GetLogicalDrives, QueryDosDeviceW, DDD_EXACT_MATCH_ON_REMOVE,
    DDD_REMOVE_DEFINITION,
};

use crate::windows::wide;

pub struct Drive {
    letter: char,
    target: PathBuf,
}

impl Drive {
    pub fn root(&self) -> PathBuf {
        PathBuf::from(format!("{}:\\", self.letter))
    }

    pub fn join(&self, relative: &Path) -> PathBuf {
        self.root().join(relative)
    }
}

impl Drop for Drive {
    fn drop(&mut self) {
        let device = wide(format!("{}:", self.letter));
        let target = wide(&self.target);
        // SAFETY: NUL-terminated strings. Removes only this exact mapping,
        // never a definition someone else made for the same letter.
        unsafe {
            DefineDosDeviceW(
                DDD_REMOVE_DEFINITION | DDD_EXACT_MATCH_ON_REMOVE,
                device.as_ptr(),
                target.as_ptr(),
            )
        };
    }
}

pub fn is_substituted(letter: char) -> bool {
    let device = wide(format!("{letter}:"));
    let mut target = vec![0u16; 1024];
    // SAFETY: a NUL-terminated name and a buffer of the given length.
    let length =
        unsafe { QueryDosDeviceW(device.as_ptr(), target.as_mut_ptr(), target.len() as u32) };
    length > 0 && String::from_utf16_lossy(&target[..4.min(length as usize)]) == r"\??\"
}

pub fn drive_for(folder: &Path) -> Result<Arc<Drive>, String> {
    static DRIVES: Mutex<Option<HashMap<PathBuf, Weak<Drive>>>> = Mutex::new(None);
    let mut drives = DRIVES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let drives = drives.get_or_insert_with(HashMap::new);
    drives.retain(|_, drive| drive.strong_count() > 0);
    let key = PathBuf::from(folder.to_string_lossy().to_lowercase());
    if let Some(drive) = drives.get(&key).and_then(Weak::upgrade) {
        return Ok(drive);
    }
    // SAFETY: no arguments.
    let used = unsafe { GetLogicalDrives() };
    let letter = ('D'..='Z')
        .rev()
        .find(|letter| used & (1 << (*letter as u32 - 'A' as u32)) == 0)
        .ok_or("Every drive letter is in use, so the command can't start.")?;
    let device = wide(format!("{letter}:"));
    let target = wide(folder);
    // SAFETY: NUL-terminated strings.
    if unsafe { DefineDosDeviceW(0, device.as_ptr(), target.as_ptr()) } == 0 {
        return Err("Windows could not prepare the command's drive.".into());
    }
    let drive = Arc::new(Drive {
        letter,
        target: folder.to_path_buf(),
    });
    drives.insert(key, Arc::downgrade(&drive));
    Ok(drive)
}
