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

/// Writes `acl` as the DACL of `path`. Only when `spread` does Windows also
/// recompute what everything below inherits, which walks the whole tree: a
/// rule that isn't inherited never needs that, and walking a folder such as
/// the person's profile would take minutes. Without `spread`, `acl` is
/// stored exactly as given, with the auto-inheritance flag of `control`.
fn write_dacl(
    path: &Path,
    acl: *const ACL,
    control: u16,
    spread: bool,
    protection: Protection,
) -> Result<(), String> {
    let failed = || "Could not change who may use the folder.".to_owned();
    let path = wide(path);
    if spread {
        let information = DACL_SECURITY_INFORMATION
            | match protection {
                Protection::Keep => 0,
                Protection::Protect => PROTECTED_DACL_SECURITY_INFORMATION,
                Protection::Unprotect => UNPROTECTED_DACL_SECURITY_INFORMATION,
            };
        // SAFETY: a valid DACL; Windows recomputes inherited entries itself.
        let status = unsafe {
            SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                information,
                ptr::null_mut(),
                ptr::null_mut(),
                acl,
                ptr::null(),
            )
        };
        return if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(failed())
        };
    }
    // SAFETY: opens the entry itself (never a link's target) for its DACL.
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(failed());
    }
    // SAFETY: the handle was just opened and is owned from here on.
    let handle = unsafe { OwnedHandle::from_raw_handle(handle.cast()) };
    let mut kept = control & (SE_DACL_AUTO_INHERITED | SE_DACL_PROTECTED);
    match protection {
        Protection::Keep => {}
        Protection::Protect => kept |= SE_DACL_PROTECTED,
        Protection::Unprotect => kept &= !SE_DACL_PROTECTED,
    }
    // Windows clears "auto-inherited" on a direct write unless it is also
    // requested, and children inherit differently without it; requesting it
    // does not reach existing children.
    if kept & SE_DACL_AUTO_INHERITED != 0 {
        kept |= SE_DACL_AUTO_INHERIT_REQ;
    }
    let settable = SE_DACL_AUTO_INHERITED | SE_DACL_AUTO_INHERIT_REQ | SE_DACL_PROTECTED;
    // SAFETY: an absolute descriptor on the stack that only borrows `acl`,
    // which outlives the call.
    let written = unsafe {
        let mut descriptor: SECURITY_DESCRIPTOR = mem::zeroed();
        let raw = ptr::addr_of_mut!(descriptor).cast();
        InitializeSecurityDescriptor(raw, SECURITY_DESCRIPTOR_REVISION) != 0
            && SetSecurityDescriptorDacl(raw, 1, acl, 0) != 0
            && SetSecurityDescriptorControl(raw, settable, kept) != 0
            && SetKernelObjectSecurity(
                handle.as_raw_handle() as HANDLE,
                DACL_SECURITY_INFORMATION,
                raw,
            ) != 0
    };
    if written {
        Ok(())
    } else {
        Err(failed())
    }
}

/// Builds a new ACL one entry at a time.
struct AclBuilder {
    buffer: Vec<u8>,
}

impl AclBuilder {
    fn new(capacity: usize) -> Self {
        let mut buffer = vec![0u8; capacity.max(8)];
        // SAFETY: `buffer` holds at least an empty ACL.
        unsafe {
            InitializeAcl(
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                ACL_REVISION,
            )
        };
        Self { buffer }
    }

    fn acl(&mut self) -> *mut ACL {
        self.buffer.as_mut_ptr().cast()
    }

    /// Appends `dacl`'s explicit entries that `keep` accepts, denials first.
    fn explicit(
        &mut self,
        dacl: &Dacl,
        keep: impl Fn(&Ace) -> bool,
        clear: u8,
    ) -> Result<(), String> {
        for denied in [true, false] {
            for ace in dacl.aces() {
                if !ace.inherited()
                    && (ace.kind() == ACCESS_DENIED_ACE_TYPE) == denied
                    && keep(&ace)
                {
                    self.copy(&ace, clear)?;
                }
            }
        }
        Ok(())
    }

    /// Appends a copy of `ace` with the `clear` flags removed.
    fn copy(&mut self, ace: &Ace, clear: u8) -> Result<(), String> {
        // SAFETY: `ace` points into a live ACL and is `AceSize` bytes long.
        let mut bytes = unsafe {
            std::slice::from_raw_parts(ace.header.cast::<u8>(), usize::from((*ace.header).AceSize))
        }
        .to_vec();
        bytes[1] &= !clear;
        // SAFETY: appends one well-formed ACE.
        let added = unsafe {
            AddAce(
                self.acl(),
                ACL_REVISION,
                u32::MAX,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
            )
        };
        if added == 0 {
            return Err("Could not change who may use the folder.".into());
        }
        Ok(())
    }

    fn allow(&mut self, sid: PSID, mask: u32, flags: u8) -> Result<(), String> {
        // SAFETY: appends one ACE; the buffer was sized with room for it.
        if unsafe { AddAccessAllowedAceEx(self.acl(), ACL_REVISION, u32::from(flags), mask, sid) }
            == 0
        {
            return Err("Could not share the folder with the sandbox.".into());
        }
        Ok(())
    }
}

/// A DACL, owned through the security descriptor it lives in.
struct Dacl {
    acl: *mut ACL,
    descriptor: PSECURITY_DESCRIPTOR,
    control: u16,
}

impl Dacl {
    fn read(path: &Path) -> Result<Self, String> {
        let path = wide(path);
        let mut acl: *mut ACL = ptr::null_mut();
        let mut descriptor = ptr::null_mut();
        // SAFETY: reads the DACL; the descriptor is freed on drop.
        let status = unsafe {
            GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut acl,
                ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err("Could not read who may use the folder.".into());
        }
        let mut dacl = Self::from_descriptor(descriptor);
        dacl.acl = acl;
        Ok(dacl)
    }

    /// Takes ownership of a LocalAlloc'd descriptor.
    fn from_descriptor(descriptor: PSECURITY_DESCRIPTOR) -> Self {
        let (mut present, mut defaulted, mut acl) = (0, 0, ptr::null_mut());
        let (mut control, mut revision) = (0u16, 0u32);
        // SAFETY: a valid descriptor; plain out-parameters.
        unsafe {
            GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted);
            GetSecurityDescriptorControl(descriptor, &mut control, &mut revision);
        }
        Self {
            acl: if present == 0 { ptr::null_mut() } else { acl },
            descriptor,
            control,
        }
    }

    fn size(&self) -> usize {
        if self.acl.is_null() {
            8
        } else {
            // SAFETY: a valid ACL header.
            usize::from(unsafe { (*self.acl).AclSize })
        }
    }

    fn aces(&self) -> impl Iterator<Item = Ace> + '_ {
        let count = if self.acl.is_null() {
            0
        } else {
            // SAFETY: a valid ACL header.
            u32::from(unsafe { (*self.acl).AceCount })
        };
        (0..count).filter_map(move |index| {
            let mut header: *mut core::ffi::c_void = ptr::null_mut();
            // SAFETY: `index` is below the ACL's ACE count.
            (unsafe { GetAce(self.acl, index, &mut header) } != 0).then_some(Ace {
                header: header.cast(),
            })
        })
    }

    /// The explicit entries naming `sid`.
    fn ours(&self, sid: PSID) -> impl Iterator<Item = Ace> + '_ {
        self.aces()
            .filter(move |ace| ace.is_for(sid) && !ace.inherited())
    }

    /// Whether the entries naming `sid` are exactly `rules`, and all explicit.
    fn has(&self, sid: PSID, rules: &[(u32, u8)]) -> bool {
        if self.aces().any(|ace| ace.is_for(sid) && ace.inherited()) {
            return false;
        }
        let ours: Vec<(u8, u32, u8)> = self
            .ours(sid)
            .map(|ace| (ace.kind(), ace.mask(), ace.flags()))
            .collect();
        ours.len() == rules.len()
            && rules
                .iter()
                .all(|&(mask, flags)| ours.contains(&(ACCESS_ALLOWED_ACE_TYPE, mask, flags)))
    }

    fn sddl(&self) -> Result<String, String> {
        let mut text: *mut u16 = ptr::null_mut();
        // SAFETY: a valid descriptor; the string is LocalAlloc'd and freed below.
        if unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                self.descriptor,
                SDDL_REVISION,
                DACL_SECURITY_INFORMATION,
                &mut text,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err("Could not read who may use the file.".into());
        }
        // SAFETY: a NUL-terminated string from the conversion above.
        let value = unsafe {
            let length = (0..).take_while(|&index| *text.add(index) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
        };
        // SAFETY: allocated by the conversion above.
        unsafe { LocalFree(text.cast()) };
        Ok(value)
    }
}

impl Drop for Dacl {
    fn drop(&mut self) {
        // SAFETY: LocalAlloc'd by the call that produced it; the ACL lives inside.
        unsafe { LocalFree(self.descriptor) };
    }
}

/// One ACE inside a live [`Dacl`].
struct Ace {
    header: *const ACE_HEADER,
}

impl Ace {
    fn kind(&self) -> u8 {
        // SAFETY: points into a live ACL.
        unsafe { (*self.header).AceType }
    }

    fn flags(&self) -> u8 {
        // SAFETY: points into a live ACL.
        unsafe { (*self.header).AceFlags }
    }

    fn inherited(&self) -> bool {
        self.flags() & INHERITED_ACE as u8 != 0
    }

    /// Allowed and denied ACEs share one layout: a mask, then a SID.
    fn simple(&self) -> bool {
        matches!(
            self.kind(),
            ACCESS_ALLOWED_ACE_TYPE | ACCESS_DENIED_ACE_TYPE
        )
    }

    fn mask(&self) -> u32 {
        if !self.simple() {
            return 0;
        }
        // SAFETY: a simple ACE, whose mask follows the header.
        unsafe { (*self.header.cast::<ACCESS_ALLOWED_ACE>()).Mask }
    }

    /// Whether this is an allowed or denied ACE naming `sid`.
    fn is_for(&self, sid: PSID) -> bool {
        if !self.simple() {
            return false;
        }
        // SAFETY: a simple ACE, whose SID follows the mask.
        unsafe {
            let ace = self.header.cast::<ACCESS_ALLOWED_ACE>();
            let ace_sid = ptr::addr_of!((*ace).SidStart).cast_mut().cast();
            EqualSid(ace_sid, sid) != 0
        }
    }
}
