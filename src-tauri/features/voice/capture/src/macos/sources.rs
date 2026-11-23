use super::{global, SYSTEM};
use crate::{CaptureError, CaptureSource, CaptureSources};
use objc2::rc::Retained;
use objc2_app_kit::NSRunningApplication;
use objc2_core_audio::{
    kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyProcessObjectList,
    kAudioObjectPropertyName, kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID,
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
    AudioObjectPropertySelector,
};
use objc2_foundation::NSString;
use std::collections::{BTreeMap, BTreeSet};
use std::mem::size_of;
use std::ptr::{self, NonNull};

pub(super) fn number(object: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<u32> {
    let address = global(selector);
    let mut value: u32 = 0;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: every pointer is to a live local of the size passed.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    };
    (status == 0).then_some(value)
}

fn name(object: AudioObjectID) -> Option<String> {
    let address = global(kAudioObjectPropertyName);
    let mut value: *mut NSString = ptr::null_mut();
    let mut size = size_of::<*mut NSString>() as u32;
    // SAFETY: every pointer is to a live local of the size passed.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    };
    if status != 0 {
        return None;
    }
    // SAFETY: the property hands back a retained CFString, toll-free bridged
    // to NSString, and this takes over that reference.
    unsafe { Retained::from_raw(value) }.map(|name| name.to_string())
}

pub(super) fn process_objects() -> Vec<AudioObjectID> {
    let address = global(kAudioHardwarePropertyProcessObjectList);
    let mut size: u32 = 0;
    // SAFETY: every pointer is to a live local.
    let status = unsafe {
        AudioObjectGetPropertyDataSize(
            SYSTEM,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
        )
    };
    if status != 0 || size == 0 {
        return Vec::new();
    }
    let mut objects: Vec<AudioObjectID> = vec![0; size as usize / size_of::<AudioObjectID>()];
    if objects.is_empty() {
        return objects;
    }
    // SAFETY: `objects` holds `size` bytes, and Core Audio writes no more than that.
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM,
            NonNull::from(&address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(objects.as_mut_slice()).cast(),
        )
    };
    if status != 0 {
        return Vec::new();
    }
    objects.truncate(size as usize / size_of::<AudioObjectID>());
    objects
}

pub(crate) fn capture_sources() -> Result<CaptureSources, CaptureError> {
    let microphone = number(SYSTEM, kAudioHardwarePropertyDefaultInputDevice)
        .and_then(name)
        .unwrap_or_else(|| "Microphone".to_owned());
    let mut apps: BTreeMap<String, BTreeSet<u32>> = BTreeMap::new();
    if objc2::available!(macos = 14.2) {
        let own = std::process::id();
        for object in process_objects() {
            if number(object, kAudioProcessPropertyIsRunningOutput) != Some(1) {
                continue;
            }
            let Some(pid) = number(object, kAudioProcessPropertyPID) else {
                continue;
            };
            if pid == own {
                continue;
            }
            let Some(app) =
                NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
            else {
                continue;
            };
            let Some(app_name) = app.localizedName().map(|name| name.to_string()) else {
                continue;
            };
            if app_name.is_empty() {
                continue;
            }
            apps.entry(app_name).or_default().insert(pid);
        }
    }
    Ok(CaptureSources {
        microphone,
        applications: apps
            .into_iter()
            .map(|(name, pids)| CaptureSource {
                name,
                pids: pids.into_iter().collect(),
            })
            .collect(),
    })
}
