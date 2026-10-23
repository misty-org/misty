use super::*;
use std::{ffi::c_void, ptr};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, HANDLE},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SDDL_REVISION_1,
        },
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
        TOKEN_USER,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

/// Where Kura finds the bridge: a pipe named for this Windows user, so
/// each user on the machine has their own.
pub fn pipe_name() -> Option<String> {
    user_sid().map(|sid| format!(r"\\.\pipe\com.misty.desktop.clipboard.{sid}"))
}

/// The SID of the user Misty runs as, as text.
fn user_sid() -> Option<String> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: plain out-parameters; the token is closed below.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return None;
    }
    let mut buffer = vec![0u8; 256];
    let mut length = 0u32;
    // SAFETY: the buffer holds `len` bytes.
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            &mut length,
        )
    } != 0;
    // SAFETY: opened above.
    unsafe { CloseHandle(token) };
    if !read {
        return None;
    }
    // SAFETY: the buffer now holds a TOKEN_USER.
    let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    let mut text: *mut u16 = ptr::null_mut();
    // SAFETY: a valid SID; the string is LocalAlloc'd and freed below.
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return None;
    }
    // SAFETY: a NUL-terminated string from the conversion above.
    let sid = unsafe {
        let length = (0..).take_while(|&index| *text.add(index) != 0).count();
        String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
    };
    // SAFETY: allocated by the conversion above.
    unsafe { LocalFree(text.cast()) };
    Some(sid)
}

/// A security descriptor that admits only `sid`.
struct OwnerOnly(PSECURITY_DESCRIPTOR);

impl OwnerOnly {
    fn new(sid: &str) -> Option<Self> {
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
            .encode_utf16()
            .chain([0])
            .collect();
        let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
        // SAFETY: a NUL-terminated SDDL string; freed on drop.
        let made = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            )
        } != 0;
        made.then_some(Self(descriptor))
    }

    fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        }
    }
}

impl Drop for OwnerOnly {
    fn drop(&mut self) {
        // SAFETY: allocated by the conversion in `new`.
        unsafe { LocalFree(self.0) };
    }
}

// SAFETY: the descriptor is immutable after creation.
unsafe impl Send for OwnerOnly {}

/// One pipe instance. The first refuses to open if another process
/// already holds the name, so nothing can stand in for Misty.
fn instance(name: &str, security: &OwnerOnly, first: bool) -> Option<NamedPipeServer> {
    let mut attributes = security.attributes();
    // SAFETY: the attributes and their descriptor outlive the call.
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(
                name,
                (&mut attributes as *mut SECURITY_ATTRIBUTES).cast::<c_void>(),
            )
    }
    .ok()
}

pub(super) fn listen(app: AppHandle, approvals: Arc<Approvals>) {
    let (Some(name), Some(sid)) = (pipe_name(), user_sid()) else {
        return;
    };
    let Some(security) = OwnerOnly::new(&sid) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let Some(mut server) = instance(&name, &security, true) else {
            return;
        };
        while server.connect().await.is_ok() {
            let Some(next) = instance(&name, &security, false) else {
                return;
            };
            let connected = std::mem::replace(&mut server, next);
            let (app, approvals) = (app.clone(), approvals.clone());
            tauri::async_runtime::spawn(async move {
                let _ = serve(connected, app, approvals).await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::windows::named_pipe::ClientOptions;

    #[tokio::test]
    async fn only_misty_can_hold_the_pipe_and_its_user_can_open_it() {
        let name = format!(r"\\.\pipe\misty-bridge-test-{}", uuid::Uuid::new_v4());
        let security = OwnerOnly::new(&user_sid().unwrap()).unwrap();
        let server = instance(&name, &security, true).unwrap();
        // Another process taking the name first would be refused the same way.
        assert!(instance(&name, &security, true).is_none());
        let _client = ClientOptions::new().open(&name).unwrap();
        server.connect().await.unwrap();
        assert!(pipe_name().unwrap().ends_with(&user_sid().unwrap()));
    }
}
