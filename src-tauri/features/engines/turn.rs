// Process helpers other features share with the engines (the project panels' git and terminal).

/// Starts the command as the leader of its own process group, so stopping it reaches its helpers.
pub fn own_group(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: a console program started from a windowed app would flash a console.
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(any(unix, windows)))]
    let _ = command;
}
