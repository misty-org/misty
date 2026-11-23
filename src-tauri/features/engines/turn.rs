pub fn own_group(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(any(unix, windows)))]
    let _ = command;
}
