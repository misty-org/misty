//! Who may use a file or folder.
//!
//! A confined process passes two access checks: one as the person, and one as
//! its container and capabilities, where only rules that allow count: a rule
//! denying a container is ignored, and so is an integrity label once the
//! container is allowed in. So a container is kept out of something only by
//! never being allowed it. Rules here only ever allow, and [`limit`] takes a
//! container's inherited allowance off one file or folder.
use std::{
    mem,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::Path,
    ptr,
};

use windows_sys::Win32::{
    Foundation::{LocalFree, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE},
    Security::{
        AddAccessAllowedAceEx, AddAce,
        Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW,
            ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW,
            SetNamedSecurityInfoW, SE_FILE_OBJECT,
        },
        EqualSid, GetAce, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, InitializeAcl,
        InitializeSecurityDescriptor, SetKernelObjectSecurity, SetSecurityDescriptorControl,
        SetSecurityDescriptorDacl, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION,
        CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, INHERIT_ONLY_ACE,
        OBJECT_INHERIT_ACE, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
        SECURITY_DESCRIPTOR, SE_DACL_AUTO_INHERITED, SE_DACL_AUTO_INHERIT_REQ, SE_DACL_PROTECTED,
        UNPROTECTED_DACL_SECURITY_INFORMATION,
    },
    Storage::FileSystem::{
        CreateFileW, DELETE, FILE_ALL_ACCESS, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
    },
};

use crate::wide;

mod dacl;
mod write;
use dacl::{Ace, Dacl};
use write::{write_dacl, AclBuilder};

const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
const SDDL_REVISION: u32 = 1;
const INHERIT: u8 = (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;

/// What a container or capability may do with a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Read, write and delete the folder and everything inside.
    Full,
    /// Read, write and delete everything inside the folder; the folder
    /// itself can't be deleted or renamed.
    Inside,
    /// Read and run the folder and everything inside.
    ReadExecute,
}

impl Access {
    /// The allow rules (access mask, inheritance flags) this access takes.
    fn rules(self) -> &'static [(u32, u8)] {
        const INSIDE_ONLY: u8 = INHERIT | INHERIT_ONLY_ACE as u8;
        match self {
            Self::Full => &[(FILE_ALL_ACCESS, INHERIT)],
            Self::Inside => &[
                (FILE_ALL_ACCESS & !DELETE, 0),
                (FILE_ALL_ACCESS, INSIDE_ONLY),
            ],
            Self::ReadExecute => &[(FILE_GENERIC_READ | FILE_GENERIC_EXECUTE, INHERIT)],
        }
    }

    /// The rules on `path`. A file has nothing to pass them on to, so it
    /// takes the folder's own rule without inheritance.
    fn rules_on(self, path: &Path) -> Vec<(u32, u8)> {
        if is_folder(path) {
            return self.rules().to_vec();
        }
        self.rules()
            .iter()
            .filter(|(_, flags)| flags & INHERIT_ONLY_ACE as u8 == 0)
            .map(|&(mask, _)| (mask, 0))
            .collect()
    }

    fn spreads(rules: &[(u32, u8)]) -> bool {
        rules.iter().any(|(_, flags)| flags & INHERIT != 0)
    }
}

/// How a write treats the DACL's protection from inheritance.
#[derive(Clone, Copy)]
enum Protection {
    Keep,
    Protect,
    Unprotect,
}

/// Whether `sid` already has exactly `access` on `path`.
pub(crate) fn has(path: &Path, sid: PSID, access: Access) -> Result<bool, String> {
    Ok(Dacl::read(path)?.has(sid, &access.rules_on(path)))
}

/// Gives `sid` `access` to `path`, replacing any other rule it had there. A
/// no-op when the rules are already there, so an inherited rule isn't spread
/// through a large folder again on every run.
pub(crate) fn grant(path: &Path, sid: PSID, access: Access) -> Result<(), String> {
    let dacl = Dacl::read(path)?;
    let rules = &access.rules_on(path);
    if dacl.has(sid, rules) {
        return Ok(());
    }
    let spread = Access::spreads(rules) || dacl.ours(sid).any(|ace| ace.flags() & INHERIT != 0);
    let mut list = AclBuilder::new(dacl.size() + rules.len() * 128);
    list.explicit(&dacl, |ace| !ace.is_for(sid), 0)?;
    for &(mask, flags) in rules {
        list.allow(sid, mask, flags)?;
    }
    for ace in dacl.aces().filter(Ace::inherited) {
        list.copy(&ace, 0)?;
    }
    let protection = Protection::Keep;
    write_dacl(path, list.acl(), dacl.control, spread, protection)
}

/// Removes every rule `sid` has on `path` itself; inherited rules below it
/// go with it.
pub(crate) fn forget(path: &Path, sid: PSID) -> Result<(), String> {
    let dacl = Dacl::read(path)?;
    if dacl.ours(sid).next().is_none() {
        return Ok(());
    }
    let spread = dacl.ours(sid).any(|ace| ace.flags() & INHERIT != 0);
    let mut list = AclBuilder::new(dacl.size());
    // Inherited entries are kept: a write that doesn't spread stores the list
    // exactly as given, and one that does recomputes them anyway.
    for ace in dacl.aces() {
        if !ace.is_for(sid) || ace.inherited() {
            list.copy(&ace, 0)?;
        }
    }
    write_dacl(path, list.acl(), dacl.control, spread, Protection::Keep)
}

/// Narrows what `sid` may do with `path` to `access` (nothing, when `None`),
/// whatever it inherits from the folder around it. `path` gets a DACL of its
/// own: the same entries as now, made explicit, minus the container's, plus
/// `access`. A folder's contents follow. Returns the original DACL for
/// [`restore`], or `None` when `path` was already narrowed this way.
pub(crate) fn limit(
    path: &Path,
    sid: PSID,
    access: Option<Access>,
) -> Result<Option<String>, String> {
    let dacl = Dacl::read(path)?;
    let protected = dacl.control & SE_DACL_PROTECTED != 0;
    let rules = access
        .map(|access| access.rules_on(path))
        .unwrap_or_default();
    if protected && dacl.has(sid, &rules) {
        return Ok(None);
    }
    let original = dacl.sddl()?;
    let mut list = AclBuilder::new(dacl.size() + rules.len() * 128);
    for kind in [ACCESS_DENIED_ACE_TYPE, ACCESS_ALLOWED_ACE_TYPE] {
        for ace in dacl.aces() {
            if ace.kind() == kind && !ace.is_for(sid) {
                list.copy(&ace, INHERITED_ACE as u8)?;
            }
        }
    }
    for &(mask, flags) in &rules {
        list.allow(sid, mask, flags)?;
    }
    let spread = is_folder(path);
    write_dacl(path, list.acl(), dacl.control, spread, Protection::Protect)?;
    Ok(Some(original))
}

/// Puts back a DACL [`limit`] returned. A folder's contents follow again.
pub(crate) fn restore(path: &Path, original: &str) -> Result<(), String> {
    let failed = || "Could not restore who may use the file.".to_owned();
    let text = wide(original);
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: parses SDDL into a self-relative descriptor freed below.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text.as_ptr(),
            SDDL_REVISION,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(failed());
    }
    let parsed = Dacl::from_descriptor(descriptor);
    if parsed.acl.is_null() {
        return Err(failed());
    }
    let spread = is_folder(path);
    let protection = if parsed.control & SE_DACL_PROTECTED != 0 {
        Protection::Protect
    } else {
        Protection::Unprotect
    };
    if !spread {
        // A file has nothing below it: the original goes back exactly.
        return write_dacl(path, parsed.acl, parsed.control, false, protection);
    }
    // A folder's inherited entries are recomputed from its parent, and its
    // contents from it, so only its own entries are written.
    let mut list = AclBuilder::new(parsed.size());
    for ace in parsed.aces().filter(|ace| !ace.inherited()) {
        list.copy(&ace, 0)?;
    }
    write_dacl(path, list.acl(), parsed.control, true, protection)
}

fn is_folder(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
}
