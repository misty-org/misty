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

/// A command line for `arguments`, quoted the way programs built with the
/// Microsoft C runtime split it back (`CommandLineToArgvW`), so each argument
/// arrives whole whatever spaces, quotes or backslashes it holds.
pub fn command_line<I, S>(arguments: I) -> OsString
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut line: Vec<u16> = Vec::new();
    for (index, argument) in arguments.into_iter().enumerate() {
        if index > 0 {
            line.push(u16::from(b' '));
        }
        let units: Vec<u16> = argument.as_ref().encode_wide().collect();
        let plain = !units.is_empty()
            && !units
                .iter()
                .any(|&unit| matches!(unit, 0x20 | 0x09 | 0x0A | 0x0B | 0x22));
        if plain {
            line.extend(units);
            continue;
        }
        line.push(u16::from(b'"'));
        const BACKSLASH: u16 = b'\\' as u16;
        let mut backslashes = 0;
        for unit in units {
            if unit == BACKSLASH {
                backslashes += 1;
                continue;
            }
            // Backslashes double only before a quote, which is escaped.
            let repeat = if unit == u16::from(b'"') {
                backslashes * 2 + 1
            } else {
                backslashes
            };
            line.extend(std::iter::repeat_n(BACKSLASH, repeat));
            line.push(unit);
            backslashes = 0;
        }
        line.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2));
        line.push(u16::from(b'"'));
    }
    std::os::windows::ffi::OsStringExt::from_wide(&line)
}

/// A Unicode environment block holding exactly `variables`, sorted by name
/// as Windows expects.
pub fn environment_block<I, K, V>(variables: I) -> Vec<u16>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<OsStr>,
    V: AsRef<OsStr>,
{
    let mut entries: Vec<(OsString, OsString)> = variables
        .into_iter()
        .map(|(name, value)| (name.as_ref().to_owned(), value.as_ref().to_owned()))
        .filter(|(name, _)| !name.is_empty() && !name.to_string_lossy().contains('='))
        .collect();
    entries.sort_by_key(|(name, _)| name.to_string_lossy().to_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (name, value) in entries {
        block.extend(name.encode_wide());
        block.push(u16::from(b'='));
        block.extend(value.encode_wide().filter(|&unit| unit != 0));
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    block
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

/// Marks handles inheritable for the length of one spawn. The attribute list
/// limits this process's child to exactly these handles.
struct Inheritable<'a>(&'a [HANDLE]);

impl<'a> Inheritable<'a> {
    fn new(handles: &'a [HANDLE]) -> Result<Self, String> {
        for (index, &handle) in handles.iter().enumerate() {
            // SAFETY: live handles owned by the caller.
            if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) }
                == 0
            {
                drop(Self(&handles[..index]));
                return Err("Could not start the command.".into());
            }
        }
        Ok(Self(handles))
    }
}

impl Drop for Inheritable<'_> {
    fn drop(&mut self) {
        for &handle in self.0 {
            // SAFETY: as above.
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
        }
    }
}

/// Owns a process-thread attribute list.
struct Attributes {
    buffer: Vec<u8>,
}

impl Attributes {
    fn new(count: u32) -> Result<Self, String> {
        let mut size = 0usize;
        // SAFETY: a size query with no buffer.
        unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &mut size) };
        let mut buffer = vec![0u8; size];
        // SAFETY: `buffer` has the size Windows asked for.
        if unsafe {
            InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), count, 0, &mut size)
        } == 0
        {
            return Err("Could not start the command.".into());
        }
        Ok(Self { buffer })
    }

    fn list(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.buffer.as_mut_ptr().cast()
    }

    /// # Safety
    /// `value` must stay alive and unmoved until the list is dropped.
    unsafe fn set<T>(
        &mut self,
        attribute: usize,
        value: *const T,
        size: usize,
    ) -> Result<(), String> {
        if UpdateProcThreadAttribute(
            self.list(),
            0,
            attribute,
            value.cast(),
            size,
            ptr::null_mut(),
            ptr::null(),
        ) == 0
        {
            return Err("Could not start the command.".into());
        }
        Ok(())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: initialized in `new`.
        unsafe { DeleteProcThreadAttributeList(self.list()) };
    }
}

#[cfg(test)]
mod tests {
    use super::command_line;
    use windows_sys::Win32::{Foundation::LocalFree, UI::Shell::CommandLineToArgvW};

    fn split(line: &std::ffi::OsStr) -> Vec<String> {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = line.encode_wide().chain([0]).collect();
        let mut count = 0;
        // SAFETY: a NUL-terminated line; the array is freed below.
        let list = unsafe { CommandLineToArgvW(wide.as_ptr(), &mut count) };
        let words = (0..count as usize)
            .map(|index| unsafe {
                let word = *list.add(index);
                let length = (0..).take_while(|&i| *word.add(i) != 0).count();
                String::from_utf16_lossy(std::slice::from_raw_parts(word, length))
            })
            .collect();
        unsafe { LocalFree(list.cast()) };
        words
    }

    #[test]
    fn arguments_survive_the_round_trip() {
        let arguments = [
            r"C:\Program Files\Tool\tool.exe",
            "plain",
            "",
            "two words",
            r#"say "hi""#,
            r"C:\ends\with\",
            r#"back\"quote"#,
            "-protocol_whitelist",
        ];
        let line = command_line(arguments);
        assert_eq!(split(&line), arguments);
    }
}
