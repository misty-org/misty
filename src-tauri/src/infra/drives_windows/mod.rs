//! Drives on Windows: the volume list and change notices.
//!
//! Drive letters come from `GetLogicalDrives`. Network drives are listed by
//! letter only: asking a disconnected share for its size can block for a long
//! time or prompt for a network logon, so it is never asked.
mod listener;
use std::{mem, ptr};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{
        BusType1394, BusTypeMmc, BusTypeSd, BusTypeUsb, CreateFileW, GetDiskFreeSpaceExW,
        GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, GetVolumeNameForVolumeMountPointW,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    },
    System::{
        Ioctl::{
            PropertyStandardQuery, StorageDeviceProperty, IOCTL_STORAGE_QUERY_PROPERTY,
            STORAGE_DEVICE_DESCRIPTOR, STORAGE_PROPERTY_QUERY,
        },
        SystemInformation::GetSystemWindowsDirectoryW,
        SystemServices::FILE_READ_ONLY_VOLUME,
        WindowsProgramming::{
            DRIVE_CDROM, DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
        },
        IO::DeviceIoControl,
    },
};

pub use listener::start_device_change_listener;

use super::drives::MountedDeviceSnapshot;
use crate::platform::shared_windows::{from_wide, wide, without_error_dialogs};

pub(super) fn scan() -> Vec<MountedDeviceSnapshot> {
    let system = system_root();
    // SAFETY: no arguments.
    let letters = unsafe { GetLogicalDrives() };
    without_error_dialogs(|| {
        (0..26u8)
            .filter(|bit| letters & (1 << bit) != 0)
            .map(|bit| (b'A' + bit) as char)
            // `subst` drives, including those agent commands run on, are
            // folders, not devices.
            .filter(|letter| !misty_windows_confine::is_substituted(*letter))
            .filter_map(|letter| describe(letter, system.as_deref()))
            .collect()
    })
}

/// "C:\" for the volume holding Windows.
fn system_root() -> Option<String> {
    let mut buffer = [0u16; 260];
    // SAFETY: the buffer length is passed alongside it.
    let length = unsafe { GetSystemWindowsDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
    let path = from_wide(&buffer[..length as usize])
        .to_string_lossy()
        .into_owned();
    path.get(..3).map(str::to_ascii_uppercase)
}

fn describe(letter: char, system: Option<&str>) -> Option<MountedDeviceSnapshot> {
    let root = format!("{letter}:\\");
    let root_wide = wide(&root);
    // SAFETY: NUL-terminated root path.
    let kind = unsafe { GetDriveTypeW(root_wide.as_ptr()) };
    if !matches!(
        kind,
        DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_REMOTE | DRIVE_CDROM | DRIVE_RAMDISK
    ) {
        return None;
    }
    let is_system = system == Some(root.as_str());
    if kind == DRIVE_REMOTE {
        return Some(MountedDeviceSnapshot {
            id: root.clone(),
            volume_id: root.clone(),
            name: format!("Network Drive ({letter}:)"),
            mount_path: root,
            fs_type: "network".to_owned(),
            is_removable: false,
            is_system: false,
            is_external: false,
            is_network: true,
            writable: true,
            total_bytes: 0,
            free_bytes: 0,
        });
    }
    // An empty card reader or optical drive has no volume to describe.
    let volume = volume_information(&root_wide)?;
    let (total_bytes, free_bytes) = free_space(&root_wide);
    let bus_removable = !is_system && kind == DRIVE_FIXED && external_bus(letter);
    let is_removable = matches!(kind, DRIVE_REMOVABLE | DRIVE_CDROM) || bus_removable;
    let fallback = match kind {
        DRIVE_REMOVABLE => "USB Drive",
        DRIVE_CDROM => "CD Drive",
        _ if bus_removable => "External Drive",
        _ => "Local Disk",
    };
    let label = if volume.label.is_empty() {
        fallback
    } else {
        volume.label.as_str()
    };
    Some(MountedDeviceSnapshot {
        id: volume.id.clone(),
        volume_id: volume.id,
        name: format!("{label} ({letter}:)"),
        mount_path: root,
        fs_type: volume.file_system,
        is_removable,
        is_system,
        is_external: is_removable,
        is_network: false,
        writable: !volume.read_only,
        total_bytes,
        free_bytes,
    })
}

struct Volume {
    id: String,
    label: String,
    file_system: String,
    read_only: bool,
}

fn volume_information(root: &[u16]) -> Option<Volume> {
    let mut label = [0u16; 261];
    let mut file_system = [0u16; 261];
    let mut serial = 0u32;
    let mut flags = 0u32;
    // SAFETY: every buffer length is passed alongside its buffer.
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            label.as_mut_ptr(),
            label.len() as u32,
            &mut serial,
            ptr::null_mut(),
            &mut flags,
            file_system.as_mut_ptr(),
            file_system.len() as u32,
        )
    } != 0;
    if !ok {
        return None;
    }
    let mut guid_path = [0u16; 64];
    // SAFETY: the buffer length is passed alongside it.
    let id = if unsafe {
        GetVolumeNameForVolumeMountPointW(
            root.as_ptr(),
            guid_path.as_mut_ptr(),
            guid_path.len() as u32,
        )
    } != 0
    {
        from_wide(&guid_path).to_string_lossy().into_owned()
    } else {
        format!("{serial:08X}")
    };
    Some(Volume {
        id,
        label: from_wide(&label).to_string_lossy().trim().to_owned(),
        file_system: from_wide(&file_system).to_string_lossy().into_owned(),
        read_only: flags & FILE_READ_ONLY_VOLUME != 0,
    })
}

fn free_space(root: &[u16]) -> (u64, u64) {
    let (mut available, mut total) = (0u64, 0u64);
    // SAFETY: plain out-parameters.
    let ok =
        unsafe { GetDiskFreeSpaceExW(root.as_ptr(), &mut available, &mut total, ptr::null_mut()) };
    if ok == 0 {
        (0, 0)
    } else {
        (total, available)
    }
}

/// A raw volume or disk handle, closed on drop.
struct Device(HANDLE);

impl Device {
    /// Opens `\\.\X:` for queries, which needs no administrator rights.
    fn volume(letter: char) -> Option<Self> {
        Self::open(&format!("\\\\.\\{letter}:"))
    }

    fn open(path: &str) -> Option<Self> {
        let path = wide(path);
        // SAFETY: NUL-terminated path; the handle is owned by the returned value.
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        (handle != INVALID_HANDLE_VALUE).then_some(Self(handle))
    }

    /// Sends a control code and reads its answer into `output`.
    fn query<I, O>(&self, code: u32, input: Option<&I>, output: &mut O) -> bool {
        let (input_ptr, input_len) = input.map_or((ptr::null(), 0), |value| {
            ((value as *const I).cast(), mem::size_of::<I>() as u32)
        });
        self.raw(
            code,
            input_ptr,
            input_len,
            (output as *mut O).cast(),
            mem::size_of::<O>() as u32,
        )
    }

    fn raw(
        &self,
        code: u32,
        input: *const std::ffi::c_void,
        input_len: u32,
        output: *mut std::ffi::c_void,
        output_len: u32,
    ) -> bool {
        let mut returned = 0u32;
        // SAFETY: callers pass live buffers with their sizes, or null and zero.
        unsafe {
            DeviceIoControl(
                self.0,
                code,
                input,
                input_len,
                output,
                output_len,
                &mut returned,
                ptr::null_mut(),
            ) != 0
        }
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        // SAFETY: the handle was opened by `Device::open` and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// Whether a fixed disk sits on a bus people unplug, such as USB or an SD slot.
fn external_bus(letter: char) -> bool {
    let Some(volume) = Device::volume(letter) else {
        return false;
    };
    let query = STORAGE_PROPERTY_QUERY {
        PropertyId: StorageDeviceProperty,
        QueryType: PropertyStandardQuery,
        AdditionalParameters: [0],
    };
    // SAFETY: an all-zero descriptor is a valid output buffer.
    let mut descriptor: STORAGE_DEVICE_DESCRIPTOR = unsafe { mem::zeroed() };
    volume.query(IOCTL_STORAGE_QUERY_PROPERTY, Some(&query), &mut descriptor)
        && [BusTypeUsb, BusType1394, BusTypeSd, BusTypeMmc].contains(&descriptor.BusType)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_system_drive_first_class() {
        let system = system_root().expect("Windows has a system drive");
        let devices = scan();
        let drive = devices
            .iter()
            .find(|device| device.mount_path == system)
            .expect("the system drive is listed");
        assert!(drive.is_system);
        assert!(!drive.is_removable);
        assert!(drive.total_bytes > 0);
        assert!(drive.name.ends_with(&format!("({})", &system[..2])));
    }
}
