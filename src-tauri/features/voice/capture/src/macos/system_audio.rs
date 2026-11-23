use super::sources::{number, process_objects};
use super::{convert_and_send, global, output_format, Delivery, StartFailure, SYSTEM};
use crate::Format;
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2_avf_audio::{AVAudioConverter, AVAudioFormat, AVAudioPCMBuffer};
use objc2_core_audio::{
    kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey,
    kAudioAggregateDeviceTapAutoStartKey, kAudioAggregateDeviceTapListKey,
    kAudioAggregateDeviceUIDKey, kAudioHardwareIllegalOperationError,
    kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyProcessObjectList,
    kAudioHardwarePropertyTranslatePIDToProcessObject, kAudioProcessPropertyPID,
    kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey, kAudioTapPropertyDescription,
    kAudioTapPropertyFormat, AudioDeviceCreateIOProcIDWithBlock, AudioDeviceDestroyIOProcID,
    AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop, AudioHardwareCreateAggregateDevice,
    AudioHardwareDestroyAggregateDevice, AudioObjectAddPropertyListenerBlock,
    AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress,
    AudioObjectPropertySelector, AudioObjectRemovePropertyListenerBlock,
    AudioObjectSetPropertyData, CATapDescription, CATapMuteBehavior,
};
use objc2_core_audio_types::{AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
use objc2_core_foundation::CFDictionary;
use objc2_foundation::{ns_string, NSArray, NSDictionary, NSNumber, NSString, NSUUID};
use std::ffi::{c_void, CStr};
use std::mem::{size_of, transmute};
use std::ptr::{self, NonNull};
use std::sync::{Arc, Mutex, OnceLock};

extern "C" {
    fn responsibility_get_pid_responsible_for_pid(pid: libc::pid_t) -> libc::pid_t;
}

fn own_processes() -> Vec<AudioObjectID> {
    // SAFETY: getpid has no preconditions.
    let own = unsafe { libc::getpid() };
    let mut objects: Vec<AudioObjectID> = process_objects()
        .into_iter()
        .filter(|object| {
            number(*object, kAudioProcessPropertyPID).is_some_and(|pid| {
                let pid = pid as libc::pid_t;
                // SAFETY: a lookup by pid with no other preconditions; a pid
                // that has gone answers with an error value, never ours.
                pid == own || unsafe { responsibility_get_pid_responsible_for_pid(pid) } == own
            })
        })
        .collect();
    objects.sort_unstable();
    objects
}

type CreateProcessTap =
    unsafe extern "C-unwind" fn(*const CATapDescription, *mut AudioObjectID) -> i32;
type DestroyProcessTap = unsafe extern "C-unwind" fn(AudioObjectID) -> i32;
type ListenerBlock = RcBlock<dyn Fn(u32, NonNull<AudioObjectPropertyAddress>)>;

#[derive(Clone, Copy)]
struct TapApi {
    create: CreateProcessTap,
    destroy: DestroyProcessTap,
}

fn tap_api() -> Option<TapApi> {
    if !objc2::available!(macos = 14.2) {
        return None;
    }
    static API: OnceLock<Option<TapApi>> = OnceLock::new();
    *API.get_or_init(|| {
        let find = |name: &CStr| {
            // SAFETY: a lookup in the images already loaded; CoreAudio is
            // linked, so its exports are among them.
            unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) }
        };
        let create = find(c"AudioHardwareCreateProcessTap");
        let destroy = find(c"AudioHardwareDestroyProcessTap");
        if create.is_null() || destroy.is_null() {
            return None;
        }
        // SAFETY: both symbols are the C functions declared in AudioHardware.h
        // with exactly these signatures.
        Some(unsafe {
            TapApi {
                create: transmute::<*mut c_void, CreateProcessTap>(create),
                destroy: transmute::<*mut c_void, DestroyProcessTap>(destroy),
            }
        })
    })
}

pub(super) fn supported() -> bool {
    tap_api().is_some()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    CoreAudio(i32),
    Device,
}

fn check(code: i32) -> Result<(), Failure> {
    if code == 0 {
        Ok(())
    } else {
        Err(Failure::CoreAudio(code))
    }
}

fn numbers(objects: &[AudioObjectID]) -> Retained<NSArray<NSNumber>> {
    let numbers: Vec<Retained<NSNumber>> = objects
        .iter()
        .map(|object| NSNumber::new_u32(*object))
        .collect();
    NSArray::from_retained_slice(&numbers)
}

fn dictionary(entries: &[(&CStr, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<Retained<NSString>> = entries
        .iter()
        .map(|(key, _)| NSString::from_str(&key.to_string_lossy()))
        .collect();
    let keys: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let values: Vec<&AnyObject> = entries.iter().map(|(_, value)| *value).collect();
    NSDictionary::from_slices(&keys, &values)
}

pub(super) struct SystemAudioCapture {
    api: TapApi,
    tap: AudioObjectID,
    device: AudioObjectID,
    io: AudioDeviceIOProcID,
    listeners: Vec<(AudioObjectPropertySelector, ListenerBlock)>,
    delivery: Arc<Delivery>,
    queue: DispatchRetained<DispatchQueue>,
}

impl SystemAudioCapture {
    fn new(api: TapApi, delivery: Arc<Delivery>) -> Self {
        Self {
            api,
            tap: 0,
            device: 0,
            io: None,
            listeners: Vec::new(),
            delivery,
            queue: DispatchQueue::new("misty.audio.system-audio", None),
        }
    }

    fn start(
        &mut self,
        processes: &[AudioObjectID],
        exclude_self: bool,
        format: Format,
    ) -> Result<(), Failure> {
        let result = self.open(processes, exclude_self, format);
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn open(
        &mut self,
        processes: &[AudioObjectID],
        exclude_self: bool,
        format: Format,
    ) -> Result<(), Failure> {
        let stereo = format.channels() == 2;
        let global_tap = processes.is_empty();
        let own = if global_tap && exclude_self {
            own_processes()
        } else {
            Vec::new()
        };
        // SAFETY: plain initialisers and setters on a fresh description.
        let description = unsafe {
            let alloc = CATapDescription::alloc();
            let description = match (global_tap, stereo) {
                (true, false) => {
                    CATapDescription::initMonoGlobalTapButExcludeProcesses(alloc, &numbers(&own))
                }
                (true, true) => {
                    CATapDescription::initStereoGlobalTapButExcludeProcesses(alloc, &numbers(&own))
                }
                (false, false) => {
                    CATapDescription::initMonoMixdownOfProcesses(alloc, &numbers(processes))
                }
                (false, true) => {
                    CATapDescription::initStereoMixdownOfProcesses(alloc, &numbers(processes))
                }
            };
            description.setName(ns_string!("Misty capture"));
            description.setPrivate(true);
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
            description
        };
        // SAFETY: the description is alive and `tap` is this capture's own field.
        check(unsafe { (self.api.create)(Retained::as_ptr(&description), &mut self.tap) })?;

        let mut asbd = AudioStreamBasicDescription {
            mSampleRate: 0.0,
            mFormatID: 0,
            mFormatFlags: 0,
            mBytesPerPacket: 0,
            mFramesPerPacket: 0,
            mBytesPerFrame: 0,
            mChannelsPerFrame: 0,
            mBitsPerChannel: 0,
            mReserved: 0,
        };
        let mut size = size_of::<AudioStreamBasicDescription>() as u32;
        let address = global(kAudioTapPropertyFormat);
        // SAFETY: every pointer is to a live local of the size passed.
        check(unsafe {
            AudioObjectGetPropertyData(
                self.tap,
                NonNull::from(&address),
                0,
                ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut asbd).cast(),
            )
        })?;
        // SAFETY: plain initialisers; nil comes back as None.
        let tap_format = unsafe {
            AVAudioFormat::initWithStreamDescription(AVAudioFormat::alloc(), NonNull::from(&asbd))
        }
        .ok_or(Failure::Device)?;
        let output = output_format(format).ok_or(Failure::Device)?;
        let converter = unsafe {
            AVAudioConverter::initFromFormat_toFormat(
                AVAudioConverter::alloc(),
                &tap_format,
                &output,
            )
        }
        .ok_or(Failure::Device)?;

        let yes = NSNumber::new_bool(true);
        let device_name = NSString::from_str("Misty private capture");
        let device_uid = NSUUID::new().UUIDString();
        // SAFETY: a plain property read.
        let tap_uid = unsafe { description.UUID() }.UUIDString();
        let sub_tap = {
            let tap_uid: &AnyObject = &tap_uid;
            let yes: &AnyObject = &yes;
            dictionary(&[
                (kAudioSubTapUIDKey, tap_uid),
                (kAudioSubTapDriftCompensationKey, yes),
            ])
        };
        let tap_list = NSArray::from_retained_slice(&[sub_tap]);
        let aggregate = {
            let device_name: &AnyObject = &device_name;
            let device_uid: &AnyObject = &device_uid;
            let yes: &AnyObject = &yes;
            let tap_list: &AnyObject = &tap_list;
            dictionary(&[
                (kAudioAggregateDeviceNameKey, device_name),
                (kAudioAggregateDeviceUIDKey, device_uid),
                (kAudioAggregateDeviceIsPrivateKey, yes),
                (kAudioAggregateDeviceTapAutoStartKey, yes),
                (kAudioAggregateDeviceTapListKey, tap_list),
            ])
        };
        // SAFETY: NSDictionary is toll-free bridged to CFDictionary, and
        // `aggregate` outlives the call.
        let bridged: &CFDictionary =
            unsafe { &*Retained::as_ptr(&aggregate).cast::<CFDictionary>() };
        check(unsafe {
            AudioHardwareCreateAggregateDevice(bridged, NonNull::from(&mut self.device))
        })?;

        let delivery = Arc::clone(&self.delivery);
        let bytes_per_frame = asbd.mBytesPerFrame;
        // SAFETY: a plain property read.
        let rate = unsafe { tap_format.sampleRate() };
        let io_block: RcBlock<
            dyn Fn(
                NonNull<AudioTimeStamp>,
                NonNull<AudioBufferList>,
                NonNull<AudioTimeStamp>,
                NonNull<AudioBufferList>,
                NonNull<AudioTimeStamp>,
            ),
        > = RcBlock::new(
            move |_now: NonNull<AudioTimeStamp>,
                  input: NonNull<AudioBufferList>,
                  _input_time: NonNull<AudioTimeStamp>,
                  _output: NonNull<AudioBufferList>,
                  _output_time: NonNull<AudioTimeStamp>| {
                // SAFETY: Core Audio passes a valid input list for the duration of the call.
                let list = unsafe { input.as_ref() };
                if list.mNumberBuffers == 0 {
                    return;
                }
                let first = &list.mBuffers[0];
                if first.mData.is_null() || bytes_per_frame == 0 {
                    return;
                }
                let frames = first.mDataByteSize / bytes_per_frame;
                if frames == 0 {
                    return;
                }
                // SAFETY: the buffer wraps the input list without copying or
                // freeing it, and lives only for this call.
                let Some(buffer) = (unsafe {
                    AVAudioPCMBuffer::initWithPCMFormat_bufferListNoCopy_deallocator(
                        AVAudioPCMBuffer::alloc(),
                        &tap_format,
                        input,
                        None,
                    )
                }) else {
                    return;
                };
                unsafe { buffer.setFrameLength(frames) };
                convert_and_send(&converter, &buffer, frames, rate, &output, &delivery);
            },
        );
        // SAFETY: `io` is this capture's own field, the queue is serial and
        // lives as long as the capture, and Core Audio copies the block.
        check(unsafe {
            AudioDeviceCreateIOProcIDWithBlock(
                NonNull::from(&mut self.io),
                self.device,
                Some(&*self.queue),
                RcBlock::as_ptr(&io_block),
            )
        })?;

        let delivery = Arc::clone(&self.delivery);
        let listener: ListenerBlock = RcBlock::new(
            move |_count: u32, _addresses: NonNull<AudioObjectPropertyAddress>| delivery.fail(),
        );
        self.listen(kAudioHardwarePropertyDefaultOutputDevice, listener)?;

        if global_tap && exclude_self {
            let tap = self.tap;
            let excluded = Mutex::new(own);
            let description = description.clone();
            let listener: ListenerBlock = RcBlock::new(
                move |_count: u32, _addresses: NonNull<AudioObjectPropertyAddress>| {
                    let now = own_processes();
                    let Ok(mut excluded) = excluded.lock() else {
                        return;
                    };
                    if *excluded == now {
                        return;
                    }
                    // SAFETY: a setter on the description this capture keeps
                    // alive, then the tap property Core Audio documents as
                    // settable, handed a pointer to that description.
                    unsafe {
                        description.setProcesses(&numbers(&now));
                        let pointer = Retained::as_ptr(&description);
                        let address = global(kAudioTapPropertyDescription);
                        AudioObjectSetPropertyData(
                            tap,
                            NonNull::from(&address),
                            0,
                            ptr::null(),
                            size_of::<*const CATapDescription>() as u32,
                            NonNull::from(&pointer).cast(),
                        );
                    }
                    *excluded = now;
                },
            );
            self.listen(kAudioHardwarePropertyProcessObjectList, listener)?;
        }
        // SAFETY: the device and IO proc were created above.
        check(unsafe { AudioDeviceStart(self.device, self.io) })
    }

    fn listen(
        &mut self,
        selector: AudioObjectPropertySelector,
        listener: ListenerBlock,
    ) -> Result<(), Failure> {
        let address = global(selector);
        let block = RcBlock::as_ptr(&listener);
        // SAFETY: the block is kept in `listeners` until `stop` removes it.
        check(unsafe {
            AudioObjectAddPropertyListenerBlock(
                SYSTEM,
                NonNull::from(&address),
                Some(&*self.queue),
                block,
            )
        })?;
        self.listeners.push((selector, listener));
        Ok(())
    }

    pub(super) fn stop(&mut self) {
        self.delivery.close();
        // SAFETY: each call undoes one that succeeded in `open`, with the same
        // arguments, in reverse order.
        unsafe {
            for (selector, listener) in self.listeners.drain(..).rev() {
                let address = global(selector);
                AudioObjectRemovePropertyListenerBlock(
                    SYSTEM,
                    NonNull::from(&address),
                    Some(&*self.queue),
                    RcBlock::as_ptr(&listener),
                );
            }
            if self.io.is_some() {
                AudioDeviceStop(self.device, self.io);
                AudioDeviceDestroyIOProcID(self.device, self.io);
            }
            self.io = None;
            if self.device != 0 {
                AudioHardwareDestroyAggregateDevice(self.device);
                self.device = 0;
            }
            if self.tap != 0 {
                (self.api.destroy)(self.tap);
                self.tap = 0;
            }
        }
    }
}

fn process_object(pid: libc::pid_t) -> Option<AudioObjectID> {
    let mut object: AudioObjectID = 0;
    let mut size = size_of::<AudioObjectID>() as u32;
    let address = global(kAudioHardwarePropertyTranslatePIDToProcessObject);
    // SAFETY: every pointer is to a live local of the size passed.
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM,
            NonNull::from(&address),
            size_of::<libc::pid_t>() as u32,
            (&pid as *const libc::pid_t).cast(),
            NonNull::from(&mut size),
            NonNull::from(&mut object).cast(),
        )
    };
    (status == 0 && object != 0).then_some(object)
}

pub(super) fn start(
    pids: &[i32],
    exclude_self: bool,
    format: Format,
    delivery: Arc<Delivery>,
) -> Result<SystemAudioCapture, StartFailure> {
    let Some(api) = tap_api() else {
        return Err(StartFailure::Unsupported);
    };
    let mut processes = Vec::new();
    if !pids.is_empty() {
        processes = pids.iter().filter_map(|pid| process_object(*pid)).collect();
        if processes.is_empty() {
            return Err(StartFailure::NoSuchProcess);
        }
    }
    let mut capture = SystemAudioCapture::new(api, delivery);
    match capture.start(&processes, exclude_self, format) {
        Ok(()) => Ok(capture),
        Err(Failure::CoreAudio(code)) if code == kAudioHardwareIllegalOperationError => {
            Err(StartFailure::Denied)
        }
        Err(_) => Err(StartFailure::Device),
    }
}
