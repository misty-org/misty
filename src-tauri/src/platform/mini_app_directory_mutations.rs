//! Mutations of immediate children in an explicitly writable directory capability.
use super::directories::{decode_name, encode_name};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};
use std::ffi::{OsStr, OsString};

pub enum Mutation {
    Create { name: String, directory: bool },
    Rename { entry: OsString, name: String },
    Remove { entry: OsString, recursive: bool },
}
impl Mutation {
    pub fn parse(method: &str, params: &Value) -> Result<Self, String> {
        let name = || -> Result<String, String> {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or("Missing entry name.")?;
            // macOS filenames are UTF-8 byte bounded; '/' and NUL cannot be a component.
            if name.is_empty()
                || name.len() > 255
                || name == "."
                || name == ".."
                || name.contains(['/', '\0'])
            {
                return Err("Expected a single filename of at most 255 UTF-8 bytes.".into());
            }
            let mut parts = std::path::Path::new(name).components();
            if !matches!(parts.next(), Some(std::path::Component::Normal(part)) if part == OsStr::new(name))
                || parts.next().is_some()
            {
                return Err("Expected an immediate child filename.".into());
            }
            Ok(name.into())
        };
        let entry = || {
            decode_name(
                params
                    .get("entry")
                    .and_then(Value::as_str)
                    .ok_or("Missing entry token.")?,
            )
        };
        match method {
            "files.createEntry" => Ok(Self::Create {
                name: name()?,
                directory: match params.get("kind").and_then(Value::as_str) {
                    Some("file") => false,
                    Some("directory") => true,
                    _ => return Err("Choose file or directory.".into()),
                },
            }),
            "files.renameEntry" => Ok(Self::Rename {
                entry: entry()?,
                name: name()?,
            }),
            "files.removeEntry" => Ok(Self::Remove {
                entry: entry()?,
                recursive: match params.get("recursive") {
                    None => false,
                    Some(Value::Bool(value)) => *value,
                    _ => return Err("Invalid recursive removal option.".into()),
                },
            }),
            _ => Err("Unknown directory mutation.".into()),
        }
    }
    pub fn run(&self, directory: &Dir) -> Result<Value, String> {
        match self {
            Self::Create {
                name,
                directory: is_directory,
            } => {
                if *is_directory {
                    directory.create_dir(name).map_err(|e| e.to_string())?;
                } else {
                    // create_new is exclusive even if another process creates a symlink first.
                    directory
                        .open_with(name, OpenOptions::new().write(true).create_new(true))
                        .map_err(|e| e.to_string())?;
                }
                Ok(
                    json!({"entry":encode_name(OsStr::new(name)),"name":name,"kind":if *is_directory {"directory"} else {"file"}}),
                )
            }
            Self::Rename { entry, name } => {
                rename_exclusive(directory, entry, OsStr::new(name)).map_err(|e| e.to_string())?;
                Ok(json!({"entry":encode_name(OsStr::new(name)),"name":name}))
            }
            Self::Remove { entry, recursive } => {
                let metadata = directory
                    .symlink_metadata(entry)
                    .map_err(|e| e.to_string())?;
                if metadata.is_dir() {
                    if *recursive {
                        directory.remove_dir_all(entry)
                    } else {
                        directory.remove_dir(entry)
                    }
                } else {
                    // Unlink the entry itself; a symlink never grants access to its target.
                    directory.remove_file(entry)
                }
                .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn rename_exclusive(directory: &Dir, from: &OsStr, to: &OsStr) -> std::io::Result<()> {
    use std::{
        ffi::CString,
        os::{fd::AsRawFd, unix::ffi::OsStrExt},
    };
    let from = CString::new(from.as_bytes())?;
    let to = CString::new(to.as_bytes())?;
    // Both validated names are single children of the same held directory descriptor.
    // RENAME_EXCL atomically prevents replacing a destination created concurrently.
    let result = unsafe {
        libc::renameatx_np(
            directory.as_raw_fd(),
            from.as_ptr(),
            directory.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}
#[cfg(not(target_os = "macos"))]
fn rename_exclusive(_directory: &Dir, _from: &OsStr, _to: &OsStr) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Exclusive App entry rename is currently available on macOS.",
    ))
}
