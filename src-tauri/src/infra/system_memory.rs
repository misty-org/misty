//! How short the computer is of memory, for agents' live pages (docs/design/agent-browser/BRIEF.md,
//! "Memory"): Misty keeps as many agent pages rendered as the system can spare, and under pressure
//! views take turns instead of failing or meeting a limit.

/// "normal", "warning" or "critical": the kernel's own memory pressure level.
#[tauri::command]
pub fn system_memory_pressure() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        let mut level: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        let name = c"kern.memorystatus_vm_pressure_level";
        let read = unsafe {
            libc::sysctlbyname(name.as_ptr(), (&mut level as *mut libc::c_int).cast(), &mut size, std::ptr::null_mut(), 0)
        };
        return match (read, level) {
            (0, 4) => "critical",
            (0, 2) => "warning",
            _ => "normal",
        };
    }
    #[cfg(not(target_os = "macos"))]
    "normal"
}
