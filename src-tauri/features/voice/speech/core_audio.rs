use std::ffi::c_void;

#[repr(C)]
struct Address {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const Address,
        qualifier_size: u32,
        qualifier: *const c_void,
        data_size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioObjectSetPropertyData(
        object: u32,
        address: *const Address,
        qualifier_size: u32,
        qualifier: *const c_void,
        data_size: u32,
        data: *const c_void,
    ) -> i32;
}

const SYSTEM: u32 = 1;
const fn code(name: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*name)
}
const GLOBAL: u32 = code(b"glob");
const OUTPUT: u32 = code(b"outp");
const MAIN: u32 = 0;

fn read<T: Default>(object: u32, selector: u32, scope: u32) -> Option<T> {
    let address = Address {
        selector,
        scope,
        element: MAIN,
    };
    let mut value = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    // SAFETY: `value` is a plain value of `size` bytes, written by the call.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut T).cast(),
        )
    };
    (status == 0).then_some(value)
}

pub(super) fn output_muted() -> bool {
    let Some(device) = read::<u32>(SYSTEM, code(b"dOut"), GLOBAL).filter(|id| *id != 0) else {
        return false;
    };
    let muted = read::<u32>(device, code(b"mute"), OUTPUT).is_some_and(|mute| mute != 0);
    let silent = read::<f32>(device, code(b"volm"), OUTPUT).is_some_and(|volume| volume < 0.01);
    muted || silent
}

fn write<T>(object: u32, selector: u32, scope: u32, value: T) {
    let address = Address {
        selector,
        scope,
        element: MAIN,
    };
    // SAFETY: `value` is a plain value of the size passed, read by the call.
    unsafe {
        AudioObjectSetPropertyData(
            object,
            &address,
            0,
            std::ptr::null(),
            std::mem::size_of::<T>() as u32,
            (&value as *const T).cast(),
        );
    }
}

pub(super) fn sound_on() {
    let Some(device) = read::<u32>(SYSTEM, code(b"dOut"), GLOBAL).filter(|id| *id != 0) else {
        return;
    };
    write::<u32>(device, code(b"mute"), OUTPUT, 0);
    if read::<f32>(device, code(b"volm"), OUTPUT).is_some_and(|volume| volume < 0.05) {
        write::<f32>(device, code(b"volm"), OUTPUT, 0.5);
    }
}

pub(super) fn output_private() -> bool {
    let Some(device) = read::<u32>(SYSTEM, code(b"dOut"), GLOBAL).filter(|id| *id != 0) else {
        return false;
    };
    let transport = read::<u32>(device, code(b"tran"), GLOBAL).unwrap_or(0);
    let wireless = transport == code(b"blue") || transport == code(b"blea");
    let wired = read::<u32>(device, code(b"ssrc"), OUTPUT) == Some(code(b"hdpn"));
    wireless || wired
}

pub(super) fn microphone_busy() -> bool {
    read::<u32>(SYSTEM, code(b"dIn "), GLOBAL)
        .filter(|id| *id != 0)
        .and_then(|device| read::<u32>(device, code(b"gone"), GLOBAL))
        .is_some_and(|running| running != 0)
}
