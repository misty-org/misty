// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Tests for `sources` (reading, writing, path resolution). Every case uses a scratch home or a
//! scratch folder and never reads or writes the person's real config.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::read::{read_dsh_profile, read_json_source, read_toml_source};
use super::write::{set_json_enabled, write_enabled};
use crate::engine_config::mcp::config::file_hash;
use std::path::{Path, PathBuf};

use super::*;

/// A scratch home for the test (`support::TestHome` holds the shared home lock, so tests that
/// change the home folder at the same time can't send this one's grok home to another scratch
/// folder).
struct HomeGuard(#[allow(dead_code)] crate::engine_config::support::TestHome);
impl HomeGuard {
    fn new(home: &Path) -> Self {
        Self(crate::engine_config::support::TestHome::set(home))
    }
}

struct Scratch(PathBuf);
impl Scratch {
    fn new(tag: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("misty-mcp-sources-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn source(id: &str) -> &'static Source {
    SOURCES.iter().find(|source| source.id == id).unwrap()
}

#[test]
fn every_declared_source_is_registered_and_consistent() {
    for entry in SOURCES {
        let spec = source_spec(entry.id).expect("registered");
        assert_eq!(spec.engine, entry.engine);
        assert_eq!(spec.writable, entry.writable);
        if entry.writable {
            assert!(entry.readonly_reason_code.is_empty());
        } else {
            assert!(!entry.readonly_reason_code.is_empty());
        }
    }
    // Only sources without cross-file semantics like `disabled_mcp_servers` are writable.
    assert!(source("grok_user").writable);
    assert!(!source("grok_project").writable);
}

#[test]
fn kimi_json_entries_read_transport_state_and_redact_url() {
    let scratch = Scratch::new("kimi");
    let path = scratch.path().join("mcp.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","pkg"],"env":{"API_KEY":"secret"}},
            "remote":{"url":"https://example.com/mcp?token=abc&x=1","headers":{"Authorization":"Bearer x"}},
            "off":{"command":"uvx","enabled":false}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("kimi_user"), &path).unwrap();
    assert_eq!(entries.len(), 3);
    let alpha = entries.iter().find(|entry| entry.name == "alpha").unwrap();
    assert!(alpha.enabled);
    assert_eq!(alpha.args_count, 2);
    assert_eq!(alpha.env_keys, vec!["API_KEY"]);
    assert!(!alpha.writable);
    assert_eq!(
        alpha.readonly_reason_code.as_deref(),
        Some(REASON_UNVERIFIED_WRITE)
    );
    let remote = entries.iter().find(|entry| entry.name == "remote").unwrap();
    assert_eq!(
        remote.url.as_deref(),
        Some("https://example.com/mcp?token=***&x=1")
    );
    assert_eq!(remote.header_keys, vec!["Authorization"]);
    let off = entries.iter().find(|entry| entry.name == "off").unwrap();
    assert!(!off.enabled);
}

#[test]
fn agy_and_qoder_use_inverted_disabled_flag() {
    let scratch = Scratch::new("agy");
    let path = scratch.path().join("mcp_config.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"on":{"command":"node","serverUrl":"https://x/mcp"},"off":{"command":"node","disabled":true}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("agy_project"), &path).unwrap();
    assert!(
        entries
            .iter()
            .find(|entry| entry.name == "on")
            .unwrap()
            .enabled
    );
    assert!(
        !entries
            .iter()
            .find(|entry| entry.name == "off")
            .unwrap()
            .enabled
    );
    assert_eq!(entries[0].format, "json");
    assert_eq!(entries[0].engine, "agy");
}

#[test]
fn opencode_command_array_becomes_command_plus_args() {
    let scratch = Scratch::new("opencode");
    let path = scratch.path().join("opencode.json");
    std::fs::write(
        &path,
        r#"{"mcp":{"web":{"type":"remote","url":"https://mcp.exa.ai/mcp","enabled":false},
            "local":{"type":"local","command":["npx","-y","pkg"],"environment":{"TOKEN":"x"}}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("opencode_project"), &path).unwrap();
    let local = entries.iter().find(|entry| entry.name == "local").unwrap();
    assert_eq!(local.command.as_deref(), Some("npx"));
    assert_eq!(local.args_count, 2);
    assert_eq!(local.env_keys, vec!["TOKEN"]);
    let web = entries.iter().find(|entry| entry.name == "web").unwrap();
    assert!(!web.enabled);
    assert_eq!(web.transport.as_deref(), Some("remote"));
}

#[test]
fn opencode_toggle_writes_enabled_and_round_trips() {
    let scratch = Scratch::new("opencode-write");
    let path = scratch.path().join("opencode.json");
    let original = "{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \"mcp\": {\n    \"local\": {\n      \"type\": \"local\",\n      \"command\": [\"npx\"]\n    }\n  }\n}\n";
    std::fs::write(&path, original).unwrap();
    let version = file_hash(original.as_bytes());
    set_json_enabled(source("opencode_project"), &path, "local", false, &version).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("\"$schema\""));
    let entries = read_json_source(source("opencode_project"), &path).unwrap();
    assert!(!entries[0].enabled);

    let version = file_hash(raw.as_bytes());
    set_json_enabled(source("opencode_project"), &path, "local", true, &version).unwrap();
    assert!(read_json_source(source("opencode_project"), &path).unwrap()[0].enabled);

    // A version conflict refuses the write; an unknown server is not_found.
    let error =
        set_json_enabled(source("opencode_project"), &path, "local", false, "stale").unwrap_err();
    assert_eq!(error.code, "conflict");
    let raw = std::fs::read_to_string(&path).unwrap();
    let version = file_hash(raw.as_bytes());
    let error =
        set_json_enabled(source("opencode_project"), &path, "ghost", false, &version).unwrap_err();
    assert_eq!(error.code, "not_found");
}

#[test]
fn omp_toggle_writes_the_enabled_field_and_round_trips() {
    // OMP's own mcp.json: `enabled: false` is the off field `/mcp disable` writes.
    let scratch = Scratch::new("omp-write");
    let path = scratch.path().join("mcp.json");
    let original = "{\n  \"mcpServers\": {\n    \"rea\": {\n      \"command\": \"cmd.exe\",\n      \"args\": [\"/c\", \"rea\"]\n    }\n  }\n}\n";
    std::fs::write(&path, original).unwrap();
    assert!(source("omp_user").writable);
    assert!(source("omp_project").writable);
    set_json_enabled(
        source("omp_user"),
        &path,
        "rea",
        false,
        &file_hash(original.as_bytes()),
    )
    .unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    let entries = read_json_source(source("omp_user"), &path).unwrap();
    assert!(!entries[0].enabled);
    let written: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        written["mcpServers"]["rea"]["enabled"],
        serde_json::json!(false)
    );
    // Every other field stays as it was.
    assert_eq!(written["mcpServers"]["rea"]["command"], "cmd.exe");
    set_json_enabled(
        source("omp_user"),
        &path,
        "rea",
        true,
        &file_hash(raw.as_bytes()),
    )
    .unwrap();
    let entries = read_json_source(source("omp_user"), &path).unwrap();
    assert!(entries[0].enabled);
}

#[test]
fn grok_disabled_list_and_enabled_field_combine_for_both_scopes() {
    let scratch = Scratch::new("grok");
    let home = scratch.path().join("home");
    std::fs::create_dir_all(home.join(".grok")).unwrap();
    let _home = HomeGuard::new(&home);
    let user_path = home.join(".grok").join("config.toml");
    std::fs::write(
        &user_path,
        "disabled_mcp_servers = [\"beta\"]\n\n[mcp_servers.alpha]\ncommand = \"npx\"\n\n[mcp_servers.beta]\ncommand = \"uvx\"\nenabled = false\n",
    )
    .unwrap();
    let entries = read_toml_source(source("grok_user"), &user_path).unwrap();
    assert!(
        entries
            .iter()
            .find(|entry| entry.name == "alpha")
            .unwrap()
            .enabled
    );
    assert!(
        !entries
            .iter()
            .find(|entry| entry.name == "beta")
            .unwrap()
            .enabled
    );
    assert_eq!(entries[0].format, "toml");

    // A same-named project server is affected by the user disabled list too.
    let workspace = scratch.path().join("ws");
    std::fs::create_dir_all(workspace.join(".grok")).unwrap();
    let project_path = workspace.join(".grok").join("config.toml");
    std::fs::write(
        &project_path,
        "[mcp_servers.beta]\nurl = \"https://x/mcp\"\n",
    )
    .unwrap();
    let project = read_toml_source(source("grok_project"), &project_path).unwrap();
    assert!(!project[0].enabled);
    assert!(!source("grok_project").writable);
}

#[test]
fn grok_toggle_updates_field_and_keeps_comments() {
    let scratch = Scratch::new("grok-write");
    let home = scratch.path().join("home");
    std::fs::create_dir_all(home.join(".grok")).unwrap();
    let _home = HomeGuard::new(&home);
    let path = home.join(".grok").join("config.toml");
    let original = "# keep\n[mcp_servers.alpha]\ncommand = \"npx\"\n\n[other]\nvalue = 1\n";
    std::fs::write(&path, original).unwrap();
    let version = file_hash(original.as_bytes());
    let entry = write_enabled("grok_user", "alpha", false, &version, None).unwrap();
    assert!(!entry.enabled);
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("# keep"));
    assert!(raw.contains("[other]"));
    assert!(raw.contains("disabled_mcp_servers"));
    assert!(raw.contains("enabled = false"));

    let version = file_hash(raw.as_bytes());
    let entry = write_enabled("grok_user", "alpha", true, &version, None).unwrap();
    assert!(entry.enabled);
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("disabled_mcp_servers"));
    assert!(raw.contains("enabled = true"));
}

#[test]
fn readonly_sources_refuse_writes() {
    let error = write_enabled("kimi_user", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
    let error = write_enabled("dsh_profile", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
}

#[test]
fn dsh_profile_entries_come_from_plugin_instances() {
    let scratch = Scratch::new("dsh");
    let path = scratch.path().join("cordis.patch.yml");
    std::fs::write(
        &path,
        "\
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: x
- id: other
  name: 'something-else'
- id: group
  insert:
    - id: mcp-web
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: true
      config:
        serverName: web
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer x
",
    )
    .unwrap();
    let entries = read_dsh_profile(&path).unwrap();
    assert_eq!(entries.len(), 2);
    let github = entries.iter().find(|entry| entry.name == "github").unwrap();
    assert!(github.enabled);
    assert_eq!(github.command.as_deref(), Some("npx"));
    assert_eq!(github.args_count, 2);
    assert_eq!(github.env_keys, vec!["GITHUB_TOKEN"]);
    assert_eq!(
        github.readonly_reason_code.as_deref(),
        Some(REASON_DSH_PLUGIN)
    );
    let web = entries.iter().find(|entry| entry.name == "web").unwrap();
    assert!(!web.enabled);
    assert_eq!(web.transport.as_deref(), Some("streamable-http"));
    assert_eq!(web.header_keys, vec!["Authorization"]);
}

#[test]
fn jsonc_sources_parse_comments_and_stay_readonly() {
    let scratch = Scratch::new("jsonc");
    let path = scratch.path().join("opencode.jsonc");
    std::fs::write(
        &path,
        r#"{
  // global config
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "local": {
      /* local server */
      "type": "local",
      "command": ["npx", "-y", "pkg"],
    },
  },
}
"#,
    )
    .unwrap();
    let entries = read_json_source(source("opencode_user"), &path).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command.as_deref(), Some("npx"));
    assert_eq!(entries[0].args_count, 2);
    // Comments would be lost, so JSONC is always read-only (even when the source could be written).
    assert!(!entries[0].writable);
    assert_eq!(
        entries[0].readonly_reason_code.as_deref(),
        Some(REASON_JSONC_READONLY)
    );
    assert!(source("opencode_user").writable);
    let error = set_json_enabled(source("opencode_user"), &path, "local", false, "").unwrap_err();
    assert_eq!(error.code, "readonly");
    // The original file wasn't rewritten (the comment is still there).
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("global config"));
}

#[test]
fn malformed_files_surface_a_source_error_not_a_panic() {
    let scratch = Scratch::new("broken");
    let json_path = scratch.path().join("dsh.json");
    std::fs::write(&json_path, "{not json").unwrap();
    assert!(read_json_source(source("kimi_user"), &json_path).is_err());
    let yaml_path = scratch.path().join("cordis.yml");
    std::fs::write(&yaml_path, "a: [unclosed").unwrap();
    assert!(read_dsh_profile(&yaml_path).is_err());
}

#[test]
fn candidate_paths_follow_cli_homes() {
    let scratch = Scratch::new("paths");
    let _home = HomeGuard::new(scratch.path());
    std::env::set_var("KIMI_CODE_HOME", scratch.path().join("kimi"));
    std::env::set_var("OMP_CODING_AGENT_DIR", scratch.path().join("omp"));
    let kimi = candidate_paths("kimi_user", None);
    assert_eq!(kimi[0], scratch.path().join("kimi").join("mcp.json"));
    let omp = candidate_paths("omp_user", None);
    assert_eq!(omp[0], scratch.path().join("omp").join("mcp.json"));
    std::env::remove_var("KIMI_CODE_HOME");
    std::env::remove_var("OMP_CODING_AGENT_DIR");
    let project = candidate_paths("kimi_local", Some("/ws"));
    assert_eq!(project[0], Path::new("/ws/.kimi-code/mcp.json"));
    assert!(candidate_paths("kimi_local", None).is_empty());
}

#[test]
fn omp_server_lists_decide_the_state_and_make_the_entry_readonly() {
    // omp 18.12 suppress rules: the user disabledServers list turns a server off; an
    // enabled:false entry on enabledServers is still on. Names on the lists can't be changed
    // through the enabled field alone.
    let scratch = Scratch::new("omp-lists");
    let path = scratch.path().join("mcp.json");
    let text = r#"{
      "mcpServers": {
        "listed_off": { "command": "a" },
        "listed_on": { "command": "b", "enabled": false },
        "plain": { "command": "c", "enabled": false }
      },
      "disabledServers": ["listed_off"],
      "enabledServers": ["listed_on"]
    }"#;
    std::fs::write(&path, text).unwrap();
    let mut entries = read_json_source(source("omp_user"), &path).unwrap();
    entries.push(McpConfigEntry {
        engine: "kimi".to_string(),
        name: "listed_off".to_string(),
        ..entries[0].clone()
    });
    apply_omp_server_lists(&mut entries, &path);
    let find = |name: &str, engine: &str| {
        entries
            .iter()
            .find(|e| e.name == name && e.engine == engine)
            .unwrap()
            .clone()
    };
    let off = find("listed_off", "omp");
    assert!(!off.enabled && !off.writable);
    assert_eq!(
        off.readonly_reason_code.as_deref(),
        Some(REASON_OMP_SERVER_LIST)
    );
    let on = find("listed_on", "omp");
    assert!(on.enabled && !on.writable);
    let plain = find("plain", "omp");
    assert!(
        !plain.enabled && plain.writable,
        "unlisted entries keep the enabled field"
    );
    assert!(
        find("listed_off", "kimi").writable,
        "only OMP follows OMP's lists"
    );

    // The write refuses too (not only the greyed-out switch); entries off the lists stay writable.
    let _guard = crate::engine_config::support::HOME_ENV_LOCK.lock();
    std::env::set_var("OMP_CODING_AGENT_DIR", scratch.path());
    let version = file_hash(text.as_bytes());
    let refused = write_enabled("omp_user", "listed_off", true, &version, None).unwrap_err();
    let plain_written = write_enabled("omp_user", "plain", true, &version, None);
    std::env::remove_var("OMP_CODING_AGENT_DIR");
    assert_eq!(refused.code, "readonly");
    assert!(plain_written.unwrap().enabled);
}

/// A source is "in the workspace" exactly when its config file lives under
/// the workspace directory — i.e. a cloned repo can ship it. That decides
/// auto-probing, the confirmation and `${ENV}` expansion, so it must follow
/// the real file locations, not a hand-kept list.
#[test]
fn workspace_sources_are_exactly_the_files_inside_the_workspace() {
    let workspace = Path::new("/ws-probe-classification");
    for source in SOURCES {
        let in_workspace = candidate_paths(source.id, workspace.to_str())
            .iter()
            .any(|path| path.starts_with(workspace));
        assert_eq!(
            crate::engine_config::mcp::source_in_workspace(source.id),
            in_workspace,
            "{}",
            source.id
        );
    }
    // Claude / Codex live in config.rs: `.mcp.json` and `.codex/config.toml`
    // are repo files; `claude_local` is per-project but in ~/.claude.json.
    for (source, expected) in [
        (SOURCE_CLAUDE_PROJECT, true),
        (SOURCE_CODEX_PROJECT, true),
        (SOURCE_CLAUDE_USER, false),
        (SOURCE_CLAUDE_LOCAL, false),
        (SOURCE_CODEX_USER, false),
    ] {
        assert_eq!(
            crate::engine_config::mcp::source_in_workspace(source),
            expected,
            "{source}"
        );
    }
    // Unknown sources are treated as untrusted.
    assert!(crate::engine_config::mcp::source_in_workspace(
        "someone_else"
    ));
}
