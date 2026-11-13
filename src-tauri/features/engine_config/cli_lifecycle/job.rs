// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// A Windows job object for an installer or probe Misty starts. `taskkill /T` walks the live
// process tree from the direct child down, so a grandchild that outlives its parent escapes it.
// A job tracks membership in the kernel instead: with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE every
// member still running dies when the last handle closes, however the run ends.

#![cfg(windows)]

use std::sync::Arc;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// Owns a kill-on-close job's handle; only `Drop` closes it.
pub(crate) struct KillOnCloseJob(HANDLE);

unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // Closing the last handle is what makes the kernel end the members still running.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// Puts `child` into a new kill-on-close job. `None` (with a log line) when Windows refuses:
/// the child already exited, or it sits in a job that forbids nesting.
pub(crate) fn assign_kill_on_close(child: &tokio::process::Child) -> Option<Arc<KillOnCloseJob>> {
    let process = child.raw_handle()? as HANDLE;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            eprintln!("[engine cli] CreateJobObjectW failed; leftover processes aren't swept");
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if configured == 0 {
            eprintln!(
                "[engine cli] SetInformationJobObject failed; leftover processes aren't swept"
            );
            CloseHandle(job);
            return None;
        }
        if AssignProcessToJobObject(job, process) == 0 {
            eprintln!(
                "[engine cli] AssignProcessToJobObject failed; leftover processes aren't swept"
            );
            CloseHandle(job);
            return None;
        }
        Some(Arc::new(KillOnCloseJob(job)))
    }
}
