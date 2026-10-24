//! Starting a process inside a container and a job.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io, mem,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr,
    time::Duration,
};

use windows_sys::Win32::{
    Foundation::{SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0},
    Security::{SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES},
    System::{
        JobObjects::AssignProcessToJobObject,
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
            UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

use crate::{wide, Capability, Container, Job};

mod attributes;
mod command;
use attributes::{Attributes, Inheritable};
pub use command::{command_line, environment_block};

const SE_GROUP_ENABLED: u32 = 0x4;

/// One process to start.
pub struct Launch<'a> {
    /// The program, by full path: nothing is looked up on PATH.
    pub application: &'a Path,
    /// The whole command line, already quoted for the program.
    pub command_line: &'a OsStr,
    /// From [`environment_block`].
    pub environment: &'a [u16],
    pub directory: &'a Path,
    /// Standard input; `NUL` when absent.
    pub stdin: Option<&'a File>,
    pub stdout: &'a File,
    pub stderr: &'a File,
    pub container: &'a Container,
    /// Shared identities the process holds besides its container.
    pub capabilities: &'a [&'a Capability],
    pub job: &'a Job,
}

/// A started process. Dropping it does not end it; its job does.
pub struct Process {
    handle: OwnedHandle,
    id: u32,
}

// SAFETY: a process handle may be waited on from any thread.
unsafe impl Send for Process {}
unsafe impl Sync for Process {}

impl Process {
    pub fn id(&self) -> u32 {
        self.id
    }

    /// Waits up to `timeout`; the exit code once the process has ended.
    pub fn wait(&self, timeout: Duration) -> Option<u32> {
        let millis = timeout.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        // SAFETY: a live process handle.
        if unsafe { WaitForSingleObject(self.raw(), millis) } != WAIT_OBJECT_0 {
            return None;
        }
        let mut code = 0u32;
        // SAFETY: the process has ended; reads its exit status.
        (unsafe { GetExitCodeProcess(self.raw(), &mut code) } != 0).then_some(code)
    }

    fn raw(&self) -> HANDLE {
        self.handle.as_raw_handle() as HANDLE
    }
}

/// An anonymous pipe: (read end, write end), neither inheritable.
pub fn pipe() -> io::Result<(File, File)> {
    let (mut read, mut write): (HANDLE, HANDLE) = (ptr::null_mut(), ptr::null_mut());
    // SAFETY: plain out-parameters; both handles are owned by the returned files.
    if unsafe { CreatePipe(&mut read, &mut write, ptr::null(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: as above.
    Ok(unsafe {
        (
            File::from_raw_handle(read.cast()),
            File::from_raw_handle(write.cast()),
        )
    })
}

/// The variables Windows needs to start an AppContainer process (it places
/// the container's profile folders from them), taken from this process.
/// They name locations only; nothing else of the caller's environment, which
/// can hold tokens, should reach a confined process.
pub fn system_variables() -> Vec<(OsString, OsString)> {
    const NEEDED: [&str; 6] = [
        "SystemRoot",
        "SystemDrive",
        "windir",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
    ];
    NEEDED
        .iter()
        .filter_map(|name| Some((OsString::from(name), std::env::var_os(name)?)))
        .collect()
}

/// Starts the process suspended inside the container, places it in the job
/// before it runs any code, and passes on only its three standard handles.
pub fn spawn(launch: &Launch) -> Result<Process, String> {
    let null_input;
    let stdin = match launch.stdin {
        Some(file) => file,
        None => {
            null_input = File::open("NUL").map_err(|_| "Could not start the command.")?;
            &null_input
        }
    };
    let standard = [
        stdin.as_raw_handle() as HANDLE,
        launch.stdout.as_raw_handle() as HANDLE,
        launch.stderr.as_raw_handle() as HANDLE,
    ];
    let mut inherited: Vec<HANDLE> = Vec::with_capacity(3);
    for handle in standard {
        if !inherited.contains(&handle) {
            inherited.push(handle);
        }
    }
    let _inheritable = Inheritable::new(&inherited)?;
    let mut held: Vec<SID_AND_ATTRIBUTES> = launch
        .capabilities
        .iter()
        .map(|capability| SID_AND_ATTRIBUTES {
            Sid: capability.sid(),
            Attributes: SE_GROUP_ENABLED,
        })
        .collect();
    let capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: launch.container.sid(),
        Capabilities: if held.is_empty() {
            ptr::null_mut()
        } else {
            held.as_mut_ptr()
        },
        CapabilityCount: held.len() as u32,
        Reserved: 0,
    };
    let mut attributes = Attributes::new(2)?;
    // SAFETY: `capabilities`, `held` and `inherited` outlive `attributes`
    // in this frame.
    unsafe {
        attributes.set(
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            &capabilities,
            mem::size_of::<SECURITY_CAPABILITIES>(),
        )?;
        attributes.set(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inherited.as_ptr(),
            mem::size_of::<HANDLE>() * inherited.len(),
        )?;
    }
    // SAFETY: an all-zero STARTUPINFOEXW is valid before its fields are set.
    let mut startup: STARTUPINFOEXW = unsafe { mem::zeroed() };
    startup.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = standard[0];
    startup.StartupInfo.hStdOutput = standard[1];
    startup.StartupInfo.hStdError = standard[2];
    startup.lpAttributeList = attributes.list();
    let application = wide(launch.application);
    let mut command_line = wide(launch.command_line);
    let directory = wide(launch.directory);
    if launch.environment.len() < 2 || !launch.environment.ends_with(&[0, 0]) {
        return Err("Could not start the command.".into());
    }
    // SAFETY: an all-zero PROCESS_INFORMATION is a valid output buffer.
    let mut process: PROCESS_INFORMATION = unsafe { mem::zeroed() };
    // SAFETY: every buffer above outlives the call.
    let started = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT
                | CREATE_SUSPENDED
                | CREATE_NO_WINDOW
                | CREATE_UNICODE_ENVIRONMENT,
            launch.environment.as_ptr().cast(),
            directory.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        )
    } != 0;
    if !started {
        return Err(format!(
            "The command could not start ({}).",
            io::Error::last_os_error()
        ));
    }
    // SAFETY: CreateProcessW returned owned handles.
    let (handle, thread) = unsafe {
        (
            OwnedHandle::from_raw_handle(process.hProcess.cast()),
            OwnedHandle::from_raw_handle(process.hThread.cast()),
        )
    };
    // SAFETY: live handles; the process is still suspended, so it never runs
    // outside the job.
    unsafe {
        if AssignProcessToJobObject(launch.job.raw(), handle.as_raw_handle() as HANDLE) == 0 {
            TerminateProcess(handle.as_raw_handle() as HANDLE, 1);
            return Err("Could not limit the command.".into());
        }
        if ResumeThread(thread.as_raw_handle() as HANDLE) == u32::MAX {
            launch.job.terminate();
            return Err("Could not start the command.".into());
        }
    }
    Ok(Process {
        handle,
        id: process.dwProcessId,
    })
}

#[cfg(test)]
mod tests;
