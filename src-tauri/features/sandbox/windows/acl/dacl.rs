//! Reading a live DACL and walking its entries.
use super::*;

/// A DACL, owned through the security descriptor it lives in.
pub(super) struct Dacl {
    pub(super) acl: *mut ACL,
    descriptor: PSECURITY_DESCRIPTOR,
    pub(super) control: u16,
}

impl Dacl {
    pub(super) fn read(path: &Path) -> Result<Self, String> {
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
    pub(super) fn from_descriptor(descriptor: PSECURITY_DESCRIPTOR) -> Self {
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

    pub(super) fn size(&self) -> usize {
        if self.acl.is_null() {
            8
        } else {
            // SAFETY: a valid ACL header.
            usize::from(unsafe { (*self.acl).AclSize })
        }
    }

    pub(super) fn aces(&self) -> impl Iterator<Item = Ace> + '_ {
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
    pub(super) fn ours(&self, sid: PSID) -> impl Iterator<Item = Ace> + '_ {
        self.aces()
            .filter(move |ace| ace.is_for(sid) && !ace.inherited())
    }

    /// Whether the entries naming `sid` are exactly `rules`, and all explicit.
    pub(super) fn has(&self, sid: PSID, rules: &[(u32, u8)]) -> bool {
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

    pub(super) fn sddl(&self) -> Result<String, String> {
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
pub(super) struct Ace {
    pub(super) header: *const ACE_HEADER,
}

impl Ace {
    pub(super) fn kind(&self) -> u8 {
        // SAFETY: points into a live ACL.
        unsafe { (*self.header).AceType }
    }

    pub(super) fn flags(&self) -> u8 {
        // SAFETY: points into a live ACL.
        unsafe { (*self.header).AceFlags }
    }

    pub(super) fn inherited(&self) -> bool {
        self.flags() & INHERITED_ACE as u8 != 0
    }

    /// Allowed and denied ACEs share one layout: a mask, then a SID.
    pub(super) fn simple(&self) -> bool {
        matches!(
            self.kind(),
            ACCESS_ALLOWED_ACE_TYPE | ACCESS_DENIED_ACE_TYPE
        )
    }

    pub(super) fn mask(&self) -> u32 {
        if !self.simple() {
            return 0;
        }
        // SAFETY: a simple ACE, whose mask follows the header.
        unsafe { (*self.header.cast::<ACCESS_ALLOWED_ACE>()).Mask }
    }

    /// Whether this is an allowed or denied ACE naming `sid`.
    pub(super) fn is_for(&self, sid: PSID) -> bool {
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
