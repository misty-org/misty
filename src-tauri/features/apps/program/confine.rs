use super::*;

#[cfg(target_os = "macos")]
pub(super) fn confined(
    program: &Path,
    work: &Path,
) -> Result<(tokio::process::Command, ()), String> {
    let failed = |_| "Misty couldn't confine the app's tools, so they weren't started.".to_owned();
    let program = fs::canonicalize(program).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let program_dir = program
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| failed(std::io::Error::other("")))?;
    let mut command = tokio::process::Command::new(sandbox::macos::SANDBOX_EXEC);
    command
        .args(sandbox::macos::arguments(
            PROFILE,
            &[
                ("TOOL", &program),
                ("PROGRAM_DIR", &program_dir),
                ("WORK", &work),
            ],
        ))
        .arg(&program);
    command.process_group(0);
    unsafe {
        command.pre_exec(|| {
            sandbox::macos::set_limits(&[
                (libc::RLIMIT_CPU, 3_600),
                (libc::RLIMIT_FSIZE, 2 << 30),
                (libc::RLIMIT_NOFILE, 256),
                (libc::RLIMIT_CORE, 0),
            ])
        });
    }
    Ok((command, ()))
}

#[cfg(target_os = "linux")]
pub(super) fn confined(
    program: &Path,
    work: &Path,
) -> Result<(tokio::process::Command, sandbox::linux::Confinement), String> {
    use sandbox::linux::{Access, Confinement, Policy};
    let failed = |_| "Misty couldn't confine the app's tools, so they weren't started.".to_owned();
    let program = fs::canonicalize(program).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let program_dir = program
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| failed(std::io::Error::other("")))?;
    let confinement = Confinement::new(&Policy {
        program: program.clone(),
        required: vec![(work, Access::Private), (program_dir, Access::Read)],
        optional: vec![
            (PathBuf::from("/usr/share"), Access::Read),
            (PathBuf::from("/etc/localtime"), Access::Read),
        ],
        forks: false,
        limits: vec![
            (libc::RLIMIT_CPU, 3_600),
            (libc::RLIMIT_FSIZE, 2 << 30),
            (libc::RLIMIT_NOFILE, 256),
            (libc::RLIMIT_CORE, 0),
        ],
    })?;
    let mut command = tokio::process::Command::new(&program);
    unsafe {
        command.pre_exec(confinement.hook());
    }
    Ok((command, confinement))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(super) fn confined(_: &Path, _: &Path) -> Result<(tokio::process::Command, ()), String> {
    Err("Misty can't confine the app's tools on this computer yet, so they don't run here.".into())
}
