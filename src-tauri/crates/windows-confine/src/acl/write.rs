//! Writing a DACL, built one entry at a time.
use super::*;

/// Writes `acl` as the DACL of `path`. Only when `spread` does Windows also
/// recompute what everything below inherits, which walks the whole tree: a
/// rule that isn't inherited never needs that, and walking a folder such as
/// the person's profile would take minutes. Without `spread`, `acl` is
/// stored exactly as given, with the auto-inheritance flag of `control`.
pub(super) fn write_dacl(
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
pub(super) struct AclBuilder {
    buffer: Vec<u8>,
}

impl AclBuilder {
    pub(super) fn new(capacity: usize) -> Self {
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

    pub(super) fn acl(&mut self) -> *mut ACL {
        self.buffer.as_mut_ptr().cast()
    }

    /// Appends `dacl`'s explicit entries that `keep` accepts, denials first.
    pub(super) fn explicit(
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
    pub(super) fn copy(&mut self, ace: &Ace, clear: u8) -> Result<(), String> {
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

    pub(super) fn allow(&mut self, sid: PSID, mask: u32, flags: u8) -> Result<(), String> {
        // SAFETY: appends one ACE; the buffer was sized with room for it.
        if unsafe { AddAccessAllowedAceEx(self.acl(), ACL_REVISION, u32::from(flags), mask, sid) }
            == 0
        {
            return Err("Could not share the folder with the sandbox.".into());
        }
        Ok(())
    }
}
