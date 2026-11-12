// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/wsl_transport.rs.
//! The WSL remote spawn channel: wraps an engine command built on this computer to run through
//! `ssh → wsl.exe`.
//!
//! When a workspace row carries `meta.wsl`, `send_message` uses this module to run the engine
//! process inside a distro on a remote Windows host:
//!
//! 1. Build a script for the distro: `cd` into the in-distro workspace, then `exec <cli>
//!    <args…>` with the engine's **in-distro** path (argv[0] resolved through the
//!    `enginePaths` table or a remote `command -v`; this computer's paths don't exist there).
//! 2. One `ssh <host> "wsl.exe -d <distro> -- tee /tmp/ccgui-wsl-<id>.sh"` writes the script
//!    through stdin (the script never enters the command string, so nothing needs escaping).
//! 3. The real run process is `ssh <host> "wsl.exe -d <distro> -- bash /tmp/….sh"` (the
//!    command string holds only fixed words, no `$`/`|`/`>`/backticks, inert under cmd and
//!    PowerShell). The script starts with `exec` (bash is replaced by the CLI): stdin (the
//!    prompt payload) and stdout (the NDJSON stream) pass straight through this pipe, and a
//!    process-group kill → ssh drops → the remote SIGHUP reaches the CLI, the same stop
//!    semantics as locally.
//!
//! Authentication: a key (BatchMode), or an SSH ControlMaster set up beforehand (`controlPath`
//! comes with the meta, and local ssh reuses the existing master without a password prompt).
//! The remote script on disk is harmless: it holds only the command line; the prompt goes
//! through stdin and is never written.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

/// The overall deadline for short remote calls (script upload, model catalogs, history
/// replay). ssh_options' ConnectTimeout covers only the TCP connect; a remote that hangs after
/// connecting (wsl.exe not answering, a full pipe) would otherwise leave the command future
/// unresolved forever, with no way to cancel from the frontend. The engine session itself (the
/// long-lived run command `wrap` builds) is not covered: it lives as long as the turn.
const REMOTE_CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// The shape of `meta.wsl`.
#[derive(Debug, Clone)]
pub struct WslTransport {
    /// The Windows host's address (IP or host name).
    pub host: String,
    pub port: u16,
    pub user: String,
    /// The distro name (wsl.exe -d).
    pub distro: String,
    /// The SSH ControlMaster socket path; None = plain BatchMode (key authentication).
    pub control_path: Option<String>,
    /// Each engine binary's absolute path inside the distro (bin name → path, written by the probe).
    pub engine_paths: HashMap<String, String>,
    /// The workspace's path inside the distro (the `cd` target; absent = the distro's default cwd).
    pub workspace: Option<String>,
}

/// Extracts the transport from a workspace's `meta` JSON; the wrong shape = None (run locally).
pub fn from_workspace_meta(meta: &serde_json::Value) -> Option<WslTransport> {
    let wsl = meta.get("wsl")?;
    let host = wsl.get("host")?.as_str()?.trim().to_string();
    if !is_safe_host(&host) {
        return None;
    }
    let user = wsl.get("user")?.as_str()?.trim().to_string();
    if !is_safe_user(&user) {
        return None;
    }
    let distro = wsl.get("distro")?.as_str()?.trim().to_string();
    if !is_safe_distro(&distro) {
        return None;
    }
    let engine_paths = wsl
        .get("enginePaths")
        .and_then(|v| v.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| {
                    let path = v.as_str()?.trim();
                    (!path.is_empty()).then(|| (k.clone(), path.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    Some(WslTransport {
        host,
        port: match wsl.get("port") {
            Some(v) => v.as_u64()?.try_into().ok()?,
            None => 22,
        },
        user,
        distro,
        control_path: wsl
            .get("controlPath")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty()),
        engine_paths,
        workspace: wsl
            .get("workspace")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty()),
    })
}

/// Character allowlists for the meta.wsl fields. These values come from db rows written over
/// IPC and are later spliced into the local ssh argv and the remote Windows command string, so
/// they are checked at the one parse entry; any violation reads as None (a local workspace),
/// failing closed.

/// The ssh login: the Linux user-name charset, never starting with `-`, or `user@host` would be
/// swallowed by ssh's getopt as an option (`-oProxyCommand=…` → a local command runs).
fn is_safe_user(user: &str) -> bool {
    !user.is_empty()
        && !user.starts_with('-')
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The host address: IP, host name or IPv6, also never starting with `-` (getopt option injection).
fn is_safe_host(host: &str) -> bool {
    !host.is_empty()
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
}

/// The distro name goes into a double-quoted string the remote DefaultShell interprets, where
/// PowerShell still evaluates `$(…)` and backticks and cmd still expands `%VAR%`: only letters,
/// digits and `._- ` pass.
fn is_safe_distro(distro: &str) -> bool {
    !distro.is_empty()
        && distro
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
}

/// The allowlist for in-distro workspace paths (the script inlines `cd <ws>` unquoted so bash
/// expands a leading `~`; spaces, `$`, `;` and the like are refused). The send path's
/// build_script and the catalog path's models/wsl.rs share this rule.
pub(crate) fn is_safe_workspace(ws: &str) -> bool {
    !ws.is_empty()
        && ws
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-' | '~'))
}

/// POSIX single-quoting of one argv element (inside a bash script).
pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Extracts program + args + explicit env from a tokio Command (every command is built in this
/// crate, so get_envs holds only what build_command set, not the inherited environment). The env
/// crosses machines through `export` lines at the script's head (MAX_THINKING_TOKENS and the
/// like; every value sh_quoted).
fn program_args_env(command: &Command) -> (String, Vec<String>, Vec<(String, String)>) {
    let std_cmd = command.as_std();
    let program = std_cmd.get_program().to_string_lossy().into_owned();
    let args = std_cmd
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let envs = std_cmd
        .get_envs()
        .filter_map(|(k, v)| {
            let key = k.to_string_lossy().into_owned();
            // An env key must be a valid shell identifier; otherwise it is dropped, never scripted.
            let valid = key.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            let value = v?.to_string_lossy().into_owned();
            valid.then(|| (key, value))
        })
        .collect();
    (program, args, envs)
}

/// Common ssh options (key authentication in BatchMode; a ControlMaster is reused when present).
fn ssh_options(transport: &WslTransport) -> Vec<String> {
    let mut opts = vec![
        "-o".to_string(),
        // Trust on first use: a known host that later changes is still stopped, but the first
        // connection doesn't verify the fingerprint, so a first LAN connection could be
        // intercepted unnoticed. A usability trade-off; the meta could carry a known host
        // fingerprint if this needs to be strict.
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
        "-p".to_string(),
        transport.port.to_string(),
    ];
    match &transport.control_path {
        // Master connection exists → no password prompt will occur; BatchMode
        // keeps a dead master from hanging the spawn waiting on input.
        Some(cp) => {
            opts.push("-o".to_string());
            opts.push(format!("ControlPath={cp}"));
            opts.push("-o".to_string());
            opts.push("BatchMode=yes".to_string());
        }
        None => {
            opts.push("-o".to_string());
            opts.push("BatchMode=yes".to_string());
        }
    }
    opts
}

fn ssh_target(transport: &WslTransport) -> String {
    format!("{}@{}", transport.user, transport.host)
}

/// The common ssh command: options + `--` + destination. `--` ends getopt parsing, so the
/// destination is never read as an option (user and host have their own allowlists; this is
/// defense in depth).
fn base_ssh_command(transport: &WslTransport) -> Command {
    let mut command = Command::new("ssh");
    for opt in ssh_options(transport) {
        command.arg(opt);
    }
    command.arg("--");
    command.arg(ssh_target(transport));
    command
}

fn wsl_command_string(transport: &WslTransport, remote_argv: &[&str]) -> String {
    let distro = transport.distro.replace('"', "");
    let joined = remote_argv
        .iter()
        .map(|a| {
            // Windows-side quoting for the string the remote DefaultShell will
            // hand to wsl.exe: double quotes, no $ / backtick / | inside (the
            // caller guarantees the safe charset: tee/bash and the UUID path are fixed words,
            // the distro passed the allowlist in from_workspace_meta, and replace is defense in depth).
            format!("\"{a}\"")
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("wsl.exe -d \"{distro}\" -- {joined}")
}

/// Resolves this computer's argv[0] to the executable path inside the distro:
/// 1. a hit in the `enginePaths` table (the program's basename, or the program itself);
/// 2. otherwise `command -v` in the script resolves it (the remote PATH).
fn resolve_remote_program(program: &str, transport: &WslTransport) -> String {
    let base = PathBuf::from(program)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.to_string());
    if let Some(p) = transport
        .engine_paths
        .get(program)
        .or_else(|| transport.engine_paths.get(&base))
    {
        return p.clone();
    }
    format!("__RESOLVE__{base}")
}

/// The script text run inside the distro. The workspace path (allowlisted by
/// is_safe_workspace) is inlined **unquoted** so bash expands a leading `~` (verified on a real
/// machine; a quoted `~` doesn't expand, and splicing `$HOME` by hand is fragile).
fn build_script(
    program: &str,
    args: &[String],
    envs: &[(String, String)],
    transport: &WslTransport,
) -> String {
    let mut script = String::new();
    script.push_str("set -e\n");
    // The script deletes itself at once: bash keeps reading its open fd after the unlink (and
    // an EXIT trap wouldn't fire under exec, so no trap is used).
    script.push_str("rm -f \"$0\"\n");
    // The env build_command set explicitly crosses machines (keys limited to shell identifiers,
    // every value single-quoted): MAX_THINKING_TOKENS, GROK_DISABLE_AUTOUPDATER and the like.
    for (key, value) in envs {
        script.push_str(&format!("export {key}={}\n", sh_quote(value)));
    }
    if let Some(ws) = &transport.workspace {
        if !is_safe_workspace(ws) {
            return format!("echo 'the workspace path has unsupported characters' >&2; exit 60\n");
        }
        script.push_str(&format!("cd {ws} || exit 61\n"));
    }
    let resolved = resolve_remote_program(program, transport);
    if let Some(base) = resolved.strip_prefix("__RESOLVE__") {
        // Resolved by a login shell (the PATH after ~/.profile): a non-login `command -v`
        // doesn't see ~/.local/bin, where engines are often installed.
        script.push_str(&format!(
            "bin=$(bash -lc {}) || exit 62\n",
            sh_quote(&format!("command -v {base}"))
        ));
        script.push_str("exec \"$bin\"");
    } else {
        script.push_str("exec ");
        script.push_str(&sh_quote(&resolved));
    }
    for a in args {
        script.push(' ');
        script.push_str(&sh_quote(a));
    }
    script.push('\n');
    script
}

fn private_script_upload_command(transport: &WslTransport, remote_path: &str) -> Result<String, String> {
    // Only internally generated filenames cross the Windows default-shell
    // layer. Do not put POSIX variables or nested double quotes in its argv.
    let id = remote_path.strip_prefix("/tmp/ccgui-wsl-")
        .and_then(|name| name.strip_suffix(".sh"))
        .ok_or_else(|| "invalid private remote script path".to_string())?;
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid private remote script path".into());
    }
    let body = format!("umask 077; set -C; cat > {}", sh_quote(remote_path));
    Ok(wsl_command_string(transport, &["bash", "-c", &body]))
}

/// Upload through stdin into an owner-only, exclusively created script. Native
/// session edits can contain the full transcript, so the remote umask cannot leak it.
async fn upload_script(
    transport: &WslTransport,
    script_body: &str,
    remote_path: &str,
) -> Result<(), String> {
    let mut command = base_ssh_command(transport);
    command.arg(private_script_upload_command(transport, remote_path)?);
    // stderr is discarded: piped but never read, it would deadlock against wait once the remote
    // fills the pipe buffer; its details never reach the error text anyway (fixed messages below).
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("ssh script upload failed: {e}"))?;
    // Bound pipe write, shutdown, and process completion together. A blocked
    // remote reader otherwise fills stdin before the wait-only deadline starts.
    let upload = async {
        let mut stdin = child.stdin.take()
            .ok_or_else(|| "ssh script upload has no stdin".to_string())?;
        use tokio::io::AsyncWriteExt;
        stdin.write_all(script_body.as_bytes()).await
            .map_err(|e| format!("ssh script write failed: {e}"))?;
        stdin.shutdown().await
            .map_err(|e| format!("ssh script upload could not close: {e}"))?;
        drop(stdin);
        child.wait().await.map_err(|e| format!("ssh script upload wait failed: {e}"))
    };
    let status = match tokio::time::timeout(REMOTE_CALL_TIMEOUT, upload).await {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.start_kill();
            return Err(format!(
                "wsl script upload timed out ({}s; check whether wsl.exe on the remote host is responding)",
                REMOTE_CALL_TIMEOUT.as_secs()
            ));
        }
    };
    if !status.success() {
        return Err("wsl script upload failed (check the remote host's connection and sign-in; the ControlMaster may have expired, so reconnect the WSL host)".to_string());
    }
    Ok(())
}

/// The wrapped result: the rebuilt ssh command + a local marker file (removed when the run ends).
pub struct Wrapped {
    pub command: Command,
    pub cleanup_files: Vec<PathBuf>,
    /// This spawn must not set a local current_dir (the remote path doesn't exist here).
    pub skip_local_cwd: bool,
}

/// Wraps the engine command build_command produced to run over remote ssh.
pub async fn wrap(command: Command, transport: &WslTransport) -> Result<Wrapped, String> {
    let (program, args, envs) = program_args_env(&command);
    let script = build_script(&program, &args, &envs, transport);
    let script_id = uuid::Uuid::new_v4().simple().to_string();
    let remote_path = format!("/tmp/ccgui-wsl-{script_id}.sh");
    upload_script(transport, &script, &remote_path).await?;

    let local_tmp = std::env::temp_dir().join(format!("ccgui-wsl-{script_id}.marker"));
    std::fs::write(&local_tmp, b"").map_err(|e| format!("couldn't write the temporary file: {e}"))?;

    let mut wrapped = base_ssh_command(transport);
    // The script is already on disk, so the run string holds only fixed words.
    wrapped.arg(wsl_command_string(transport, &["bash", &remote_path]));
    Ok(Wrapped {
        command: wrapped,
        cleanup_files: vec![local_tmp],
        skip_local_cwd: true,
    })
}

/// Whether a workspace is remote, from its db row's meta JSON.
pub fn transport_from_meta_json(meta_json: Option<&str>) -> Option<WslTransport> {
    let raw = meta_json?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    from_workspace_meta(&value)
}

/// A workspace's meta text, by path.
pub fn workspace_meta_json(db: &crate::engines::support::db::Db, workspace_path: &str) -> Option<String> {
    let conn = db.read();
    conn.query_row(
        "SELECT meta FROM cli_workspaces WHERE path = ?1",
        [workspace_path],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

/// A local cwd that always exists, for a remote workspace's spawn.
pub fn fallback_cwd() -> &'static std::path::Path {
    std::path::Path::new(".")
}

/// Runs a script remotely and returns its stdout (short commands such as model lists; upload
/// then run, with the same ssh/wsl strings and authentication as the send path). Transport
/// noise is already stripped (NUL residue and wsl.exe diagnostic lines, particular to the wsl
/// channel; the payload is untouched).
pub async fn run_script_output(
    transport: &WslTransport,
    script_body: &str,
) -> Result<String, String> {
    let script_id = uuid::Uuid::new_v4().simple().to_string();
    let remote_path = format!("/tmp/ccgui-wsl-{script_id}.sh");
    // The caller's script also deletes itself at once (bash keeps reading its open fd).
    let body = format!("rm -f \"$0\"\n{script_body}");
    upload_script(transport, &body, &remote_path).await?;
    let mut command = base_ssh_command(transport);
    command.arg(wsl_command_string(transport, &["bash", &remote_path]));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // The overall deadline (see REMOTE_CALL_TIMEOUT): model catalogs and history replay come
    // through here, and a hung remote must not stall the frontend. kill_on_drop: dropping the
    // output future on timeout SIGKILLs the local ssh (the remote script already deleted itself).
    command.kill_on_drop(true);
    let output = match tokio::time::timeout(REMOTE_CALL_TIMEOUT, command.output()).await {
        Ok(result) => result.map_err(|e| format!("the remote command failed to run: {e}"))?,
        Err(_) => {
            return Err(format!(
                "the remote command timed out ({}s; check whether wsl.exe on the remote host is responding)",
                REMOTE_CALL_TIMEOUT.as_secs()
            ));
        }
    };
    if !output.status.success() {
        return Err(format!(
            "the remote command exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&strip_transport_noise(output.stdout.as_slice())).to_string())
}

/// wsl.exe transport noise: NUL residue (after a lossy UTF-16LE decode) and diagnostic lines
/// starting with `wsl:`/`wsl.`. Line structure is kept and payload lines pass unchanged.
fn strip_transport_noise(raw: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(raw).replace('\0', "");
    text.lines()
        .filter(|l| {
            let t = l.trim_start();
            !(t.starts_with("wsl:") || t.starts_with("wsl."))
        })
        .map(|l| format!("{l}\n"))
        .collect::<Vec<_>>()
        .join("")
        .into_bytes()
}

/// Workspace path → transport in one step (the db read and the meta parse both live here).
pub fn transport_for_workspace(db: &crate::engines::support::db::Db, workspace_path: &str) -> Option<WslTransport> {
    transport_from_meta_json(workspace_meta_json(db, workspace_path).as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn private_script_upload_rejects_non_generated_paths() {
        for path in ["/tmp/other.sh", "/tmp/ccgui-wsl-$(id).sh", "/tmp/ccgui-wsl-00.sh", "/tmp/ccgui-wsl-0123456789abcdef0123456789abcdef.sh;echo injected"] {
            assert!(private_script_upload_command(&tp(), path).is_err());
        }
    }

    fn tp() -> WslTransport {
        WslTransport {
            host: "10.0.0.2".into(),
            port: 22,
            user: "dev".into(),
            distro: "Ubuntu-22.04".into(),
            control_path: None,
            engine_paths: HashMap::from([(
                "omp".to_string(),
                "/home/dev/.local/bin/omp".to_string(),
            )]),
            workspace: Some("/home/dev/proj".into()),
        }
    }

    #[test]
    fn meta_parses_engine_paths_and_workspace() {
        let meta = json!({"wsl": {
            "host": "10.0.0.2", "port": 2222, "user": "dev", "distro": "Ubuntu",
            "controlPath": "/tmp/m", "workspace": "/home/dev/p",
            "enginePaths": {"omp": "/home/dev/.local/bin/omp"}
        }});
        let t = from_workspace_meta(&meta).unwrap();
        assert_eq!(t.port, 2222);
        assert_eq!(t.control_path.as_deref(), Some("/tmp/m"));
        assert_eq!(
            t.engine_paths.get("omp").unwrap(),
            "/home/dev/.local/bin/omp"
        );
        assert_eq!(t.workspace.as_deref(), Some("/home/dev/p"));
    }

    #[test]
    fn script_maps_bin_cd_and_quotes_args() {
        let script = build_script(
            "/Users/x/.local/bin/omp",
            &[
                "-p".into(),
                "hello world".into(),
                "--resume".into(),
                "s-1".into(),
            ],
            &[],
            &tp(),
        );
        assert!(script.starts_with("set -e\n"));
        assert!(script.contains("cd /home/dev/proj || exit 61"));
        // argv[0]'s basename "omp" hits enginePaths → the in-distro path
        assert!(script.contains("exec '/home/dev/.local/bin/omp'"));
        assert!(script.contains("'hello world'"));
        // No local macOS path survives
        assert!(!script.contains("/Users/"));
    }

    #[test]
    fn script_keeps_tilde_unquoted_for_native_expansion() {
        let mut t = tp();
        t.workspace = Some("~/code/proj".into());
        let script = build_script("omp", &[], &[], &t);
        assert!(script.contains("cd ~/code/proj || exit 61"));
        // Quoting would kill bash's tilde expansion, so it must never appear
        assert!(!script.contains("\"~/"));
    }

    #[test]
    fn script_rejects_space_paths() {
        let mut t = tp();
        t.workspace = Some("/home/dev/my proj".into());
        let script = build_script("omp", &[], &[], &t);
        assert!(script.contains("exit 60"));
    }

    #[test]
    fn script_falls_back_to_command_v() {
        let script = build_script("kimi", &[], &[], &tp());
        assert!(script.contains("bin=$(bash -lc 'command -v kimi') || exit 62"));
        assert!(script.contains("exec \"$bin\""));
    }

    #[test]
    fn remote_command_string_is_shell_inert() {
        let s = wsl_command_string(&tp(), &["bash", "/tmp/x.sh"]);
        assert_eq!(s, "wsl.exe -d \"Ubuntu-22.04\" -- \"bash\" \"/tmp/x.sh\"");
        assert!(!s.contains('$') && !s.contains('|') && !s.contains('`'));
    }

    #[test]
    fn meta_rejects_ssh_option_injection_user() {
        // A user starting with `-`: ssh's getopt would swallow `user@host` as a -o option
        // (ProxyCommand → a local command runs), so it is refused outright.
        let meta = json!({"wsl": {
            "host": "10.0.0.2", "user": "-oProxyCommand=/tmp/evil@x", "distro": "Ubuntu"
        }});
        assert!(from_workspace_meta(&meta).is_none());
    }

    #[test]
    fn meta_rejects_dash_host_and_bad_chars() {
        for host in ["-oProxyCommand=x", "ho st", "ho;st", "ho`id`st"] {
            let meta = json!({"wsl": { "host": host, "user": "dev", "distro": "Ubuntu" }});
            assert!(from_workspace_meta(&meta).is_none(), "host: {host}");
        }
        // IPv6, host names and dotted user names are valid
        let meta = json!({"wsl": {
            "host": "::1", "user": "dev.ops-1_x", "distro": "Ubuntu"
        }});
        assert!(from_workspace_meta(&meta).is_some());
    }

    #[test]
    fn meta_rejects_distro_shell_chars() {
        // PowerShell still evaluates $(…) and backticks inside double quotes; cmd still expands %VAR%
        for distro in ["Ubuntu$(id)", "u`id`", "u%PATH%", "u\"&id", "u|id"] {
            let meta = json!({"wsl": { "host": "10.0.0.2", "user": "dev", "distro": distro }});
            assert!(from_workspace_meta(&meta).is_none(), "distro: {distro}");
        }
        let meta = json!({"wsl": {
            "host": "10.0.0.2", "user": "dev", "distro": "Ubuntu-22.04 LTS"
        }});
        assert!(from_workspace_meta(&meta).is_some());
    }

    #[test]
    fn workspace_allowlist() {
        assert!(is_safe_workspace("/home/dev/proj"));
        assert!(is_safe_workspace("~/code/proj"));
        assert!(!is_safe_workspace("/home/dev/my proj"));
        assert!(!is_safe_workspace("/a;id"));
        assert!(!is_safe_workspace("/a$(id)"));
        assert!(!is_safe_workspace(""));
    }

    #[test]
    fn script_exports_env_and_self_deletes() {
        let envs = vec![("MAX_THINKING_TOKENS".to_string(), "65536".to_string())];
        let script = build_script("omp", &[], &envs, &tp());
        // Deleted at once (a trap wouldn't fire under exec; unlinking a script with an open fd is safe)
        assert!(script.contains("rm -f \"$0\""));
        assert!(script.contains("export MAX_THINKING_TOKENS='65536'"));
        // A value with quotes or spaces goes through sh_quote too, never spliced raw
        let envs = vec![("X_Y".to_string(), "a'b c".to_string())];
        let script = build_script("omp", &[], &envs, &tp());
        assert!(script.contains("export X_Y='a'\\''b c'"));
    }

    #[test]
    fn ssh_command_separates_destination_with_double_dash() {
        let cmd = base_ssh_command(&tp());
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let dashdash = args.iter().position(|a| a == "--").expect("missing --");
        // The destination follows `--` directly, with no non-option value before it
        assert_eq!(args[dashdash + 1], "dev@10.0.0.2");
        assert!(args[..dashdash]
            .iter()
            .all(|a| a.starts_with('-') || !a.contains('@')));
    }

    #[test]
    fn workspace_meta_json_reads_without_waiting_for_writer_mutex() {
        let dir = std::env::temp_dir().join(format!("ccgui-wsl-meta-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::engines::support::db::Db::open_at(&dir.join("app.db")).unwrap();
        db.0.lock()
            .execute(
                "INSERT INTO cli_workspaces(id, path, name, sort_order, meta)
                 VALUES('w1', '/ws/proj', 'proj', 0, '{\"wsl\":{\"host\":\"10.0.0.2\"}}')",
                [],
            )
            .unwrap();
        let _writer_guard = db.0.lock();
        let meta = workspace_meta_json(&db, "/ws/proj");
        assert_eq!(meta.as_deref(), Some("{\"wsl\":{\"host\":\"10.0.0.2\"}}"));
        drop(_writer_guard);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
