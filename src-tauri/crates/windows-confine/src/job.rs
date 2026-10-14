//! Job objects: limits for a whole process tree, and an end to all of it.
use std::{
    mem,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr,
    time::Duration,
};

use windows_sys::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
        JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOB_OBJECT_LIMIT_PROCESS_TIME, JOB_OBJECT_UILIMIT_DESKTOP,
        JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
        JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES,
        JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
        JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    },
};

/// Limits every process in a job shares. Each process gets its own memory
/// and CPU allowance; `processes` caps how many run at once.
pub struct JobLimits {
    pub process_memory: usize,
    pub process_cpu: Duration,
    pub processes: u32,
}

/// A Job object. Closing it (dropping this) ends every process in it, and
/// processes started inside it can't leave it.
pub struct Job(OwnedHandle);

// SAFETY: a job handle may be used from any thread.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub fn new(limits: &JobLimits) -> Result<Self, String> {
        // SAFETY: an anonymous job; owned by the returned value.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err("Could not limit the sandbox.".into());
        }
        // SAFETY: the handle was just created and is owned from here on.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle.cast()) });
        // SAFETY: an all-zero limit structure is valid before its fields are set.
        let mut extended: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
        let basic = &mut extended.BasicLimitInformation;
        basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_PROCESS_TIME;
        basic.ActiveProcessLimit = limits.processes.max(1);
        // In 100-nanosecond units.
        basic.PerProcessUserTimeLimit = (limits.process_cpu.as_nanos() / 100) as i64;
        extended.ProcessMemoryLimit = limits.process_memory;
        let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
            UIRestrictionsClass: JOB_OBJECT_UILIMIT_DESKTOP
                | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                | JOB_OBJECT_UILIMIT_EXITWINDOWS
                | JOB_OBJECT_UILIMIT_GLOBALATOMS
                | JOB_OBJECT_UILIMIT_HANDLES
                | JOB_OBJECT_UILIMIT_READCLIPBOARD
                | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                | JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
        };
        // SAFETY: each structure and its size describe a live value.
        let ok = unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&extended as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) != 0
                && SetInformationJobObject(
                    job.raw(),
                    JobObjectBasicUIRestrictions,
                    (&ui as *const JOBOBJECT_BASIC_UI_RESTRICTIONS).cast(),
                    mem::size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
                ) != 0
        };
        if ok {
            Ok(job)
        } else {
            Err("Could not limit the sandbox.".into())
        }
    }

    pub(crate) fn raw(&self) -> HANDLE {
        self.0.as_raw_handle() as HANDLE
    }

    /// Ends every process in the job now.
    pub fn terminate(&self) {
        // SAFETY: a live job handle.
        unsafe { TerminateJobObject(self.raw(), 1) };
    }
}
