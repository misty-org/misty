// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::read::{read_json_source, read_toml_source};
use super::write::write_enabled;
use crate::engine_config::mcp::config::file_hash;
use std::path::{Path, PathBuf};

use super::*;

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
fn json_entries_read_transport_state_and_redact_url() {
    let scratch = Scratch::new("agy-user");
    let path = scratch.path().join("mcp_config.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","pkg"],"env":{"API_KEY":"secret"}},
            "remote":{"url":"https://example.com/mcp?token=abc&x=1","headers":{"Authorization":"Bearer x"}},
            "off":{"command":"uvx","disabled":true}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("agy_user"), &path).unwrap();
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
fn agy_uses_inverted_disabled_flag() {
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
    let error = write_enabled("agy_user", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
    let error = write_enabled("agy_project", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
}

#[test]
fn jsonc_sources_parse_comments_and_stay_readonly() {
    let scratch = Scratch::new("jsonc");
    let path = scratch.path().join("mcp.jsonc");
    std::fs::write(
        &path,
        r#"{
  // global config
  "mcpServers": {
    "local": {
      /* local server */
      "command": "npx",
      "args": ["-y", "pkg"],
    },
  },
}
"#,
    )
    .unwrap();
    let entries = read_json_source(source("agy_user"), &path).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command.as_deref(), Some("npx"));
    assert_eq!(entries[0].args_count, 2);
    assert!(!entries[0].writable);
    assert_eq!(
        entries[0].readonly_reason_code.as_deref(),
        Some(REASON_JSONC_READONLY)
    );
}

#[test]
fn malformed_files_surface_a_source_error_not_a_panic() {
    let scratch = Scratch::new("broken");
    let json_path = scratch.path().join("mcp.json");
    std::fs::write(&json_path, "{not json").unwrap();
    assert!(read_json_source(source("agy_user"), &json_path).is_err());
    assert!(read_json_source(source("kimi_user"), &json_path).is_err());
}

#[test]
fn candidate_paths_follow_cli_homes() {
    let scratch = Scratch::new("paths");
    let _home = HomeGuard::new(scratch.path());
    std::env::set_var("ANTIGRAVITY_HOME", scratch.path().join("agy"));
    let user = candidate_paths("agy_user", None);
    assert_eq!(
        user[1],
        scratch
            .path()
            .join("agy")
            .join("config")
            .join("mcp_config.json")
    );
    std::env::remove_var("ANTIGRAVITY_HOME");
    std::env::set_var("KIMI_CODE_HOME", scratch.path().join("kimi"));
    let kimi = candidate_paths("kimi_user", None);
    assert_eq!(kimi[0], scratch.path().join("kimi").join("mcp.json"));
    std::env::remove_var("KIMI_CODE_HOME");
    let local = candidate_paths("kimi_local", Some("/ws"));
    assert_eq!(local[0], Path::new("/ws/.kimi-code/mcp.json"));
    assert!(candidate_paths("kimi_local", None).is_empty());
    let project = candidate_paths("agy_project", Some("/ws"));
    assert_eq!(project[0], Path::new("/ws/.agents/mcp_config.json"));
    assert!(candidate_paths("agy_project", None).is_empty());
}

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
    assert!(crate::engine_config::mcp::source_in_workspace(
        "someone_else"
    ));
}
