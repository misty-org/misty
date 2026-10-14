//! Drives on Windows: the volume list, safe removal and change notices.
//!
//! Drive letters come from `GetLogicalDrives`. Network drives are listed by
//! letter only: asking a disconnected share for its size can block for a long
//! time or prompt for a network logon, so it is never asked.
mod listener;
use std::{mem, ptr};

use windows_sys::Win32::{
    Devices::DeviceAndDriverInstallation::{
        CM_Get_Parent, CM_Request_Device_EjectW, PNP_VetoTypeUnknown, SetupDiDestroyDeviceInfoList,
        SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW,
        CR_SUCCESS, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, SP_DEVICE_INTERFACE_DATA,
        SP_DEVICE_INTERFACE_DETAIL_DATA_W, SP_DEVINFO_DATA,
    },
    Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE},
    NetworkManagement::WNet::WNetCancelConnection2W,
    Storage::FileSystem::{
        BusType1394, BusTypeMmc, BusTypeSd, BusTypeUsb, CreateFileW, GetDiskFreeSpaceExW,
        GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, GetVolumeNameForVolumeMountPointW,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    },
    System::{
        Ioctl::{
            PropertyStandardQuery, StorageDeviceProperty, FSCTL_DISMOUNT_VOLUME, FSCTL_LOCK_VOLUME,
            GUID_DEVINTERFACE_DISK, IOCTL_STORAGE_EJECT_MEDIA, IOCTL_STORAGE_GET_DEVICE_NUMBER,
            IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_DEVICE_DESCRIPTOR, STORAGE_DEVICE_NUMBER,
            STORAGE_PROPERTY_QUERY,
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

use super::devices::MountedDeviceSnapshot;
use crate::{
    error::{ApiError, ApiResult},
    platform::windows::{from_wide, wide, without_error_dialogs},
};

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
    /// Opens `\\.\X:` without needing administrator rights unless `write` is asked.
    fn volume(letter: char, write: bool) -> Option<Self> {
        Self::open(&format!("\\\\.\\{letter}:"), write)
    }

    fn open(path: &str, write: bool) -> Option<Self> {
        let path = wide(path);
        let access = if write {
            GENERIC_READ | GENERIC_WRITE
        } else {
            0
        };
        // SAFETY: NUL-terminated path; the handle is owned by the returned value.
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        (handle != INVALID_HANDLE_VALUE).then_some(Self(handle))
    }

    /// Sends a control code with no input and no output.
    fn command(&self, code: u32) -> bool {
        self.raw(code, ptr::null(), 0, ptr::null_mut(), 0)
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
    let Some(volume) = Device::volume(letter, false) else {
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

/// Safely removes a drive the way the taskbar's "Eject" does, or disconnects
/// a network drive. Open files make Windows refuse, and nothing is forced.
pub(super) fn remove(device: &MountedDeviceSnapshot) -> ApiResult<()> {
    let letter = device
        .mount_path
        .chars()
        .next()
        .filter(char::is_ascii_alphabetic)
        .ok_or_else(|| ApiError::Message("That drive has no drive letter.".to_owned()))?;
    if device.is_network {
        let name = wide(format!("{letter}:"));
        // SAFETY: NUL-terminated local name; `false` refuses while files are open.
        let status = unsafe { WNetCancelConnection2W(name.as_ptr(), 0, 0) };
        return if status == 0 {
            Ok(())
        } else {
            Err(ApiError::Message(
                "Windows could not disconnect that network drive. Close files using it and try again.".to_owned(),
            ))
        };
    }
    let busy = || {
        ApiError::Message(
            "Windows could not eject that drive. Close files and windows using it, then try again."
                .to_owned(),
        )
    };
    // Flush and detach the file system, then let the handle go: Plug and Play
    // refuses to remove a disk while any handle to it is open.
    let disk = {
        let volume = Device::volume(letter, true).ok_or_else(busy)?;
        // SAFETY: an all-zero device number is a valid output buffer.
        let mut number: STORAGE_DEVICE_NUMBER = unsafe { mem::zeroed() };
        if !volume.command(FSCTL_LOCK_VOLUME)
            || !volume.command(FSCTL_DISMOUNT_VOLUME)
            || !volume.query(IOCTL_STORAGE_GET_DEVICE_NUMBER, None::<&()>, &mut number)
        {
            return Err(busy());
        }
        number.DeviceNumber
    };
    if eject_disk(disk).is_some() {
        return Ok(());
    }
    // Optical drives and card readers stay attached; only their media leaves.
    let volume = Device::volume(letter, true).ok_or_else(busy)?;
    if volume.command(IOCTL_STORAGE_EJECT_MEDIA) {
        Ok(())
    } else {
        Err(busy())
    }
}

/// Asks Plug and Play to remove the disk with this number, as the taskbar does.
fn eject_disk(number: u32) -> Option<()> {
    // SAFETY: SetupAPI enumeration over present disk interfaces; the list is
    // destroyed on every path below.
    unsafe {
        let set = SetupDiGetClassDevsW(
            &GUID_DEVINTERFACE_DISK,
            ptr::null(),
            ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        );
        if set == INVALID_HANDLE_VALUE as isize {
            return None;
        }
        let instance = (0..)
            .map_while(|index| {
                let mut interface: SP_DEVICE_INTERFACE_DATA = mem::zeroed();
                interface.cbSize = mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
                (SetupDiEnumDeviceInterfaces(
                    set,
                    ptr::null(),
                    &GUID_DEVINTERFACE_DISK,
                    index,
                    &mut interface,
                ) != 0)
                    .then_some(interface)
            })
            .find_map(|interface| disk_instance(set, &interface, number));
        SetupDiDestroyDeviceInfoList(set);
        let instance = instance?;
        // Removable disks eject themselves; a USB enclosure ejects through its parent.
        for candidate in [Some(instance), parent(instance)].into_iter().flatten() {
            let mut veto = PNP_VetoTypeUnknown;
            if CM_Request_Device_EjectW(candidate, &mut veto, ptr::null_mut(), 0, 0) == CR_SUCCESS
                && veto == PNP_VetoTypeUnknown
            {
                return Some(());
            }
        }
        None
    }
}

/// The device instance of the disk interface whose disk number is `number`.
unsafe fn disk_instance(
    set: isize,
    interface: &SP_DEVICE_INTERFACE_DATA,
    number: u32,
) -> Option<u32> {
    let mut required = 0u32;
    SetupDiGetDeviceInterfaceDetailW(
        set,
        interface,
        ptr::null_mut(),
        0,
        &mut required,
        ptr::null_mut(),
    );
    if (required as usize) < mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() {
        return None;
    }
    // u32 storage keeps the detail structure aligned.
    let mut buffer = vec![0u32; (required as usize).div_ceil(4)];
    let detail = buffer
        .as_mut_ptr()
        .cast::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();
    (*detail).cbSize = mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
    let mut info: SP_DEVINFO_DATA = mem::zeroed();
    info.cbSize = mem::size_of::<SP_DEVINFO_DATA>() as u32;
    if SetupDiGetDeviceInterfaceDetailW(
        set,
        interface,
        detail,
        required,
        ptr::null_mut(),
        &mut info,
    ) == 0
    {
        return None;
    }
    let path_units =
        (required as usize - mem::offset_of!(SP_DEVICE_INTERFACE_DETAIL_DATA_W, DevicePath)) / 2;
    let path = std::slice::from_raw_parts(
        ptr::addr_of!((*detail).DevicePath).cast::<u16>(),
        path_units,
    );
    let disk = Device::open(&from_wide(path).to_string_lossy(), false)?;
    let mut found: STORAGE_DEVICE_NUMBER = mem::zeroed();
    (disk.query(IOCTL_STORAGE_GET_DEVICE_NUMBER, None::<&()>, &mut found)
        && found.DeviceNumber == number)
        .then_some(info.DevInst)
}

fn parent(instance: u32) -> Option<u32> {
    let mut parent = 0u32;
    // SAFETY: plain out-parameter.
    (unsafe { CM_Get_Parent(&mut parent, instance, 0) } == CR_SUCCESS).then_some(parent)
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
