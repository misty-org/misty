use std::{path::Path, ptr, sync::Mutex};

use windows_sys::Win32::{
    Foundation::{LocalFree, ERROR_ALREADY_EXISTS},
    Security::{
        Authorization::ConvertSidToStringSidW,
        DeriveCapabilitySidsFromName, FreeSid,
        Isolation::{
            CreateAppContainerProfile, DeleteAppContainerProfile,
            DeriveAppContainerSidFromAppContainerName,
        },
        PSID,
    },
};

use crate::windows::{acl, wide, Access};

pub struct Container {
    sid: PSID,
}

// SAFETY: the SID is immutable after creation and freed once, on drop.
unsafe impl Send for Container {}
unsafe impl Sync for Container {}

impl Container {
    pub fn open(name: &str) -> Result<Self, String> {
        static CREATING: Mutex<()> = Mutex::new(());
        let _turn = CREATING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let name_wide = wide(name);
        let mut sid: PSID = ptr::null_mut();
        // SAFETY: NUL-terminated strings; the returned SID is freed on drop.
        let created = unsafe {
            CreateAppContainerProfile(
                name_wide.as_ptr(),
                name_wide.as_ptr(),
                name_wide.as_ptr(),
                ptr::null(),
                0,
                &mut sid,
            )
        };
        if created < 0 {
            if created != (0x8007_0000u32 | ERROR_ALREADY_EXISTS) as i32 {
                return Err("Windows could not create the sandbox.".into());
            }
            // SAFETY: as above.
            if unsafe { DeriveAppContainerSidFromAppContainerName(name_wide.as_ptr(), &mut sid) }
                < 0
            {
                return Err("Windows could not find the sandbox.".into());
            }
        }
        Ok(Self { sid })
    }

    pub fn sid(&self) -> PSID {
        self.sid
    }

    pub fn delete(name: &str) {
        let name = wide(name);
        // SAFETY: a NUL-terminated name; a missing profile is not an error here.
        unsafe { DeleteAppContainerProfile(name.as_ptr()) };
    }

    pub fn grant(&self, path: &Path, access: Access) -> Result<(), String> {
        acl::grant(path, self.sid, access)
    }

    pub fn forget(&self, path: &Path) -> Result<(), String> {
        acl::forget(path, self.sid)
    }

    pub fn limit(&self, path: &Path, access: Option<Access>) -> Result<Option<String>, String> {
        acl::limit(path, self.sid, access)
    }

    pub fn restore(&self, path: &Path, original: &str) -> Result<(), String> {
        acl::restore(path, original)
    }
}

impl Drop for Container {
    fn drop(&mut self) {
        // SAFETY: allocated by the AppContainer functions above.
        unsafe { FreeSid(self.sid) };
    }
}

pub struct Capability {
    sid: PSID,
}

// SAFETY: the SID is immutable after creation and freed once, on drop.
unsafe impl Send for Capability {}
unsafe impl Sync for Capability {}

impl Capability {
    pub fn named(name: &str) -> Result<Self, String> {
        let name = wide(name);
        let (mut groups, mut group_count): (*mut PSID, u32) = (ptr::null_mut(), 0);
        let (mut sids, mut count): (*mut PSID, u32) = (ptr::null_mut(), 0);
        // SAFETY: plain out-parameters. Every returned SID and both arrays
        // are LocalAlloc'd; all are freed here except the one SID kept.
        let derived = unsafe {
            DeriveCapabilitySidsFromName(
                name.as_ptr(),
                &mut groups,
                &mut group_count,
                &mut sids,
                &mut count,
            )
        } != 0;
        let mut kept: PSID = ptr::null_mut();
        // SAFETY: the arrays hold `group_count` and `count` SIDs.
        unsafe {
            for index in 0..group_count as usize {
                LocalFree(*groups.add(index));
            }
            for index in 0..count as usize {
                if index == 0 {
                    kept = *sids;
                } else {
                    LocalFree(*sids.add(index));
                }
            }
            if !groups.is_null() {
                LocalFree(groups.cast());
            }
            if !sids.is_null() {
                LocalFree(sids.cast());
            }
        }
        if !derived || kept.is_null() {
            return Err("Windows could not prepare the sandbox.".into());
        }
        Ok(Self { sid: kept })
    }

    pub fn sid(&self) -> PSID {
        self.sid
    }

    pub fn sid_string(&self) -> Result<String, String> {
        let mut text: *mut u16 = ptr::null_mut();
        // SAFETY: a valid SID; the string is LocalAlloc'd and freed below.
        if unsafe { ConvertSidToStringSidW(self.sid, &mut text) } == 0 {
            return Err("Windows could not describe the sandbox.".into());
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

    pub fn grant(&self, path: &Path, access: Access) -> Result<(), String> {
        acl::grant(path, self.sid, access)
    }

    pub fn has(&self, path: &Path, access: Access) -> Result<bool, String> {
        acl::has(path, self.sid, access)
    }

    pub fn forget(&self, path: &Path) -> Result<(), String> {
        acl::forget(path, self.sid)
    }
}

impl Drop for Capability {
    fn drop(&mut self) {
        // SAFETY: allocated by DeriveCapabilitySidsFromName with LocalAlloc.
        unsafe { LocalFree(self.sid) };
    }
}
