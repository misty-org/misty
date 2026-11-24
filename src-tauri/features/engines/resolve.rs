use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use tokio::process::Command;

const RESOLUTION_CACHE_TTL: Duration = Duration::from_secs(30);
const NPM_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const NPM_REAP_TIMEOUT: Duration = Duration::from_millis(250);
const NPM_PREFIX_MAX_BYTES: u64 = 16 * 1024;

static EXTRA_SEARCH_PATHS_CACHE: StdMutex<Option<(Vec<PathBuf>, Instant)>> = StdMutex::new(None);

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| paths_equal(existing, &path)) {
        paths.push(path);
    }
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn resolve_npm_global_bin_dir_from_prefix(prefix: &str) -> Option<PathBuf> {
    let trimmed = prefix.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("undefined")
        || trimmed.eq_ignore_ascii_case("null")
    {
        return None;
    }
    let prefix_path = PathBuf::from(trimmed);

    #[cfg(windows)]
    {
        Some(prefix_path)
    }
    #[cfg(not(windows))]
    {
        let normalized = if prefix_path.file_name() == Some(std::ffi::OsStr::new("bin")) {
            prefix_path
        } else {
            prefix_path.join("bin")
        };
        Some(normalized)
    }
}

fn reap_npm_probe(child: &mut tokio::process::Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => return false,
        }
    }
}

fn discover_npm_global_bin_dir(seed_paths: &[PathBuf]) -> Option<PathBuf> {
    let joined_paths = std::env::join_paths(seed_paths.iter()).ok()?;
    let cwd = std::env::current_dir().ok()?;
    let npm_bin = which::which_in("npm", Some(&joined_paths), &cwd)
        .ok()
        .or_else(|| which::which("npm").ok())?;
    let npm_bin = strip_verbatim(upgrade_executable_variant(npm_bin));

    let mut command = command_for_binary(&npm_bin.to_string_lossy());
    command.env("PATH", &joined_paths);
    command.args(["config", "get", "prefix"]);
    command.stdin(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());
    command.kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    super::hide_console(&mut command);

    let mut output_file = file_access::fs::File::unnamed_temp().ok()?;
    let result = (|| {
        use std::io::{Read, Seek, SeekFrom};

        command.stdout(output_file.try_clone().ok()?);
        let deadline = Instant::now() + NPM_PROBE_TIMEOUT;
        let mut child = {
            let runtime = tauri::async_runtime::handle();
            let _entered = runtime.inner().enter();
            command.spawn().ok()?
        };
        let pid = child.id()?;
        #[cfg(windows)]
        let tree_guard = super::job::assign_kill_on_close(&child);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None)
                    if Instant::now() < deadline
                        && output_file
                            .metadata()
                            .map(|metadata| metadata.len() <= NPM_PREFIX_MAX_BYTES)
                            .unwrap_or(false) =>
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => break None,
            }
        };
        #[cfg(unix)]
        super::kill_process_group(pid);
        #[cfg(windows)]
        {
            if status.is_none() && tree_guard.is_none() {
                super::kill_process_group(pid);
            }
            drop(tree_guard);
        }
        if status.is_none() {
            let _ = child.start_kill();
            if !reap_npm_probe(&mut child, NPM_REAP_TIMEOUT) {
                eprintln!("[engine] npm probe reap deadline exceeded; cleanup is incomplete");
            }
            return None;
        }
        if !status?.success() {
            return None;
        }
        output_file.seek(SeekFrom::Start(0)).ok()?;
        let mut stdout = Vec::new();
        (&mut output_file)
            .take(NPM_PREFIX_MAX_BYTES + 1)
            .read_to_end(&mut stdout)
            .ok()?;
        if stdout.len() as u64 > NPM_PREFIX_MAX_BYTES {
            return None;
        }
        resolve_npm_global_bin_dir_from_prefix(&String::from_utf8_lossy(&stdout))
    })();
    drop(command);
    drop(output_file);
    result
}

#[cfg(any(windows, test))]
fn build_windows_extra_search_paths(
    appdata: Option<&Path>,
    user_profile: Option<&Path>,
    local_app_data: Option<&Path>,
    program_files: Option<&Path>,
    program_files_x86: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Some(appdata) = appdata {
        paths.push(appdata.join("npm"));
    }
    if let Some(user_profile) = user_profile {
        paths.push(user_profile.join("AppData\\Roaming\\npm"));
        paths.push(user_profile.join(".local\\bin"));
        paths.push(user_profile.join(".codex-cli\\bin"));
        paths.push(user_profile.join(".local\\share\\mise\\shims"));
        paths.push(user_profile.join(".cargo\\bin"));
        paths.push(user_profile.join(".bun\\bin"));
        let codemoss_sdk_root =
            user_profile.join(".codemoss\\dependencies\\claude-sdk\\node_modules\\@anthropic-ai");
        if let Ok(entries) = std::fs::read_dir(&codemoss_sdk_root) {
            for entry in entries.flatten() {
                let candidate = entry.path();
                if candidate.is_dir()
                    && entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("claude-agent-sdk-win32-")
                {
                    paths.push(candidate);
                }
            }
        }
        paths.push(user_profile.join("scoop\\shims"));
        paths.push(user_profile.join("scoop\\apps\\nodejs\\current"));
        paths.push(user_profile.join("scoop\\apps\\nodejs-lts\\current"));
        paths.push(user_profile.join("scoop\\persist\\nodejs"));
        paths.push(user_profile.join("scoop\\persist\\nodejs\\bin"));
        let fnm_root = user_profile.join("AppData\\Local\\fnm\\node-versions");
        if let Ok(entries) = std::fs::read_dir(&fnm_root) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("installation");
                if bin_path.is_dir() {
                    paths.push(bin_path);
                }
            }
        }
        let nvm_root = user_profile.join("AppData\\Roaming\\nvm");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir()
                    && path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with('v'))
                {
                    paths.push(path);
                }
            }
        }
    }
    if let Some(local_app_data) = local_app_data {
        paths.push(local_app_data.join("Volta\\bin"));
        paths.push(local_app_data.join("pnpm"));
        paths.push(local_app_data.join("mise\\shims"));
        let fnm_multishells = local_app_data.join("fnm_multishells");
        if let Ok(entries) = std::fs::read_dir(&fnm_multishells) {
            for entry in entries.flatten() {
                let candidate = entry.path();
                if candidate.is_dir() {
                    paths.push(candidate);
                }
            }
        }
        let programs_root = local_app_data.join("Programs");
        if programs_root.is_dir() {
            paths.push(programs_root.join("nodejs"));
            paths.push(programs_root.join("OpenAI\\Codex\\bin"));
            if let Ok(entries) = std::fs::read_dir(&programs_root) {
                for entry in entries.flatten() {
                    let candidate = entry.path();
                    if !candidate.is_dir() {
                        continue;
                    }
                    let folder_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if folder_name == "nodejs"
                        || folder_name.starts_with("node-v")
                        || folder_name.starts_with("nodejs-v")
                    {
                        paths.push(candidate);
                    }
                }
            }
        }
    }
    if let Some(program_files) = program_files {
        paths.push(program_files.join("nodejs"));
    }
    if let Some(program_files_x86) = program_files_x86 {
        paths.push(program_files_x86.join("nodejs"));
    }

    paths
}

#[cfg(not(windows))]
#[allow(
    clippy::disallowed_methods,
    reason = "looks for the folders installed programs live in, which lie outside the gate"
)]
fn build_unix_extra_search_paths() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".codex-cli/bin"));
        paths.push(home.join(".local/share/mise/shims"));
        paths.push(home.join(".cargo/bin"));
        paths.push(home.join(".bun/bin"));
        paths.push(home.join(".volta/bin"));
        paths.push(home.join(".claude/local"));
        paths.push(home.join(".npm-global/bin"));
        let nvm_root = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(nvm_root) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.is_dir() {
                    paths.push(bin_path);
                }
            }
        }
    }
    for folder in login_shell_path()
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
    {
        if !paths.contains(&folder) {
            paths.push(folder);
        }
    }
    paths
}

#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
    static ASKED: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    ASKED.get_or_init(ask_login_shell_path).clone()
}

#[cfg(not(windows))]
fn ask_login_shell_path() -> Option<String> {
    const MARK: &str = "__MISTY_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut output = (!cfg!(test)).then(tempfile::tempfile)?.ok()?;
    let mut child = std::process::Command::new(shell)
        .args(["-l", "-i", "-c", &format!("echo '{MARK}'\"$PATH\"")])
        .stdin(std::process::Stdio::null())
        .stdout(output.try_clone().ok()?)
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
    std::io::Seek::rewind(&mut output).ok()?;
    let text = std::io::read_to_string(std::io::Read::take(output, 1 << 20)).ok()?;
    let path = text.rsplit(MARK).next()?.lines().next()?.trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[cfg(any(windows, test))]
fn expand_windows_env_vars(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(resolved) => out.push_str(&resolved),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(any(windows, test))]
fn parse_registry_path_value(value: &str) -> Vec<PathBuf> {
    expand_windows_env_vars(value)
        .split(';')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(windows)]
fn registry_environment_paths() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut paths: Vec<PathBuf> = Vec::new();
    for (root, subkey) in [
        (HKEY_CURRENT_USER, "Environment"),
        (
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
    ] {
        if let Ok(key) = RegKey::predef(root).open_subkey(subkey) {
            if let Ok(value) = key.get_value::<String, _>("Path") {
                for path in parse_registry_path_value(&value) {
                    push_unique_path(&mut paths, path);
                }
            }
        }
    }
    paths
}

fn get_extra_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").ok();
        let user_profile = std::env::var("USERPROFILE").ok();
        let local_app_data = std::env::var("LOCALAPPDATA").ok();
        let program_files = std::env::var("ProgramFiles").ok();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").ok();
        paths.extend(build_windows_extra_search_paths(
            appdata.as_deref().map(Path::new),
            user_profile.as_deref().map(Path::new),
            local_app_data.as_deref().map(Path::new),
            program_files.as_deref().map(Path::new),
            program_files_x86.as_deref().map(Path::new),
        ));
        paths.extend(registry_environment_paths());
    }
    #[cfg(not(windows))]
    {
        paths.extend(build_unix_extra_search_paths());
    }

    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        if !codex_home.trim().is_empty() {
            push_unique_path(&mut paths, PathBuf::from(codex_home.trim()).join("bin"));
        }
    }

    for prefix_key in ["NPM_CONFIG_PREFIX", "npm_config_prefix"] {
        if let Some(env_prefix) = std::env::var_os(prefix_key)
            .and_then(|value| value.into_string().ok())
            .and_then(|value| resolve_npm_global_bin_dir_from_prefix(&value))
        {
            push_unique_path(&mut paths, env_prefix);
        }
    }

    let seed_paths = build_seed_search_paths(None, &paths);
    if let Some(npm_global_bin) = discover_npm_global_bin_dir(&seed_paths) {
        push_unique_path(&mut paths, npm_global_bin);
    }

    paths
}

fn cached_extra_search_paths() -> Vec<PathBuf> {
    if let Ok(guard) = EXTRA_SEARCH_PATHS_CACHE.try_lock() {
        if let Some((paths, cached_at)) = guard.as_ref() {
            if cached_at.elapsed() <= RESOLUTION_CACHE_TTL {
                return paths.clone();
            }
        }
    }
    let paths = get_extra_search_paths();
    if let Ok(mut guard) = EXTRA_SEARCH_PATHS_CACHE.lock() {
        *guard = Some((paths.clone(), Instant::now()));
    }
    paths
}

#[allow(
    clippy::disallowed_methods,
    reason = "looks for the folders installed programs live in, which lie outside the gate"
)]
fn build_seed_search_paths(custom_bin: Option<&str>, extra_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut all_paths: Vec<PathBuf> = Vec::new();

    if let Some(bin_path) = custom_bin.filter(|v| !v.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path)
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            push_unique_path(&mut all_paths, parent.to_path_buf());
        }
    }
    if let Ok(system_path) = std::env::var("PATH") {
        for p in std::env::split_paths(&system_path) {
            push_unique_path(&mut all_paths, p);
        }
    }
    for extra in extra_paths {
        if extra.is_dir() {
            push_unique_path(&mut all_paths, extra.clone());
        }
    }
    all_paths
}

fn build_search_paths(custom_bin: Option<&str>) -> std::ffi::OsString {
    let misty = crate::engines::support::paths::installed_program_dirs();
    search_path_with(custom_bin, &misty)
}

pub(crate) fn search_path_with(
    custom_bin: Option<&str>,
    misty_dirs: &[PathBuf],
) -> std::ffi::OsString {
    let extra = [cached_extra_search_paths(), misty_dirs.to_vec()].concat();
    let all_paths = build_seed_search_paths(custom_bin, &extra);
    std::env::join_paths(all_paths).unwrap_or_default()
}

pub(crate) fn cli_search_path() -> std::ffi::OsString {
    build_search_paths(None)
}

#[cfg(any(windows, test))]
fn prefer_windows_executable_variant(path: PathBuf) -> PathBuf {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if matches!(
        ext.as_deref(),
        Some("cmd") | Some("exe") | Some("bat") | Some("com") | Some("ps1")
    ) {
        return path;
    }
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return path;
    };
    let Some(parent) = path.parent() else {
        return path;
    };
    for preferred_ext in ["cmd", "exe", "bat", "com", "ps1"] {
        let candidate = parent.join(format!("{file_name}.{preferred_ext}"));
        if candidate.exists() {
            return candidate;
        }
    }
    path
}

fn upgrade_executable_variant(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        prefer_windows_executable_variant(path)
    }
    #[cfg(not(windows))]
    {
        path
    }
}

#[cfg(any(windows, test))]
fn windows_wrapper(bin: &str) -> Option<(&'static str, Vec<String>)> {
    let trimmed = bin.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        Some(("cmd", vec!["/c".to_string(), trimmed.to_string()]))
    } else if lower.ends_with(".ps1") {
        Some((
            "powershell",
            vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                trimmed.to_string(),
            ],
        ))
    } else {
        None
    }
}

pub(crate) fn command_for_binary(bin: &str) -> Command {
    #[cfg(windows)]
    if let Some((program, leading)) = windows_wrapper(bin) {
        let mut cmd = Command::new(program);
        cmd.args(leading);
        return cmd;
    }
    super::support::paths::own_copy_command(bin)
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        if !stripped.starts_with(r"UNC\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves an engine's installed program, which lives outside the gate"
)]
pub(crate) fn find_cli_binary(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    if let Some(bin) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let bin_path = Path::new(bin.trim());
        if bin_path.exists() {
            return Some(strip_verbatim(upgrade_executable_variant(
                bin_path.to_path_buf(),
            )));
        }
    }

    #[cfg(windows)]
    {
        for search_path in cached_extra_search_paths() {
            for ext in ["cmd", "exe", "bat", "com", "ps1"] {
                let candidate = search_path.join(format!("{name}.{ext}"));
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    let search_paths = build_search_paths(custom_bin);
    if let Ok(cwd) = std::env::current_dir() {
        if let Ok(found) = which::which_in(name, Some(&search_paths), &cwd) {
            return Some(upgrade_executable_variant(found));
        }
    }

    which::which(name).ok().map(upgrade_executable_variant)
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves an engine's installed program, which lives outside the gate"
)]
pub(crate) fn resolve_launchable_cli_binary(name_or_path: &str) -> String {
    let trimmed = name_or_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let path = Path::new(trimmed);
    if path.exists() {
        return strip_verbatim(upgrade_executable_variant(path.to_path_buf()))
            .to_string_lossy()
            .into_owned();
    }
    let looks_like_path = path.is_absolute() || trimmed.contains('/') || trimmed.contains('\\');
    if looks_like_path {
        return trimmed.to_string();
    }
    find_cli_binary(trimmed, None)
        .map(|found| found.to_string_lossy().into_owned())
        .unwrap_or_else(|| trimmed.to_string())
}

pub fn find_program(name: &str) -> Option<PathBuf> {
    find_cli_binary(name, None)
}

pub fn command_for(path: &Path) -> Command {
    command_for_binary(&path.to_string_lossy())
}

pub fn search_path() -> std::ffi::OsString {
    cli_search_path()
}

pub async fn version_of(bin: &str) -> Option<String> {
    let mut command = command_for_binary(bin);
    command
        .arg("--version")
        .env("PATH", cli_search_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    super::hide_console(&mut command);
    let output = tokio::time::timeout(std::time::Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod tests;
