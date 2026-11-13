// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Skills hub regression tests.
//!
//! Folders and environment: the SSOT points at a scratch folder through `MISTY_SKILLS_HUB_HOME`;
//! engine homes go through `MISTY_TEST_ENGINE_HOME` (which `support::home_dir` reads in tests),
//! holding `support::HOME_ENV_LOCK`. Every write lands in a scratch folder and never touches the
//! real home.

#![allow(clippy::disallowed_methods, clippy::disallowed_types)] // Fixtures are built with the standard library.

use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Environment changes are process-wide, so every test that makes them runs one at a time under
/// the shared lock, never stepping on another module's home tests.
struct EnvGuard {
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    _lock: parking_lot::MutexGuard<'static, ()>,
}

static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

impl EnvGuard {
    fn new(vars: &[(&'static str, &Path)]) -> Self {
        let lock = crate::engine_config::support::HOME_ENV_LOCK.lock();
        let mut saved = Vec::new();
        // The SSOT root defaults to Misty's app_home; tests override it explicitly, and those that
        // don't (such as the engine-folder tests that only move the home) still never reach the
        // person's real data.
        for (key, value) in vars {
            saved.push((*key, std::env::var_os(key)));
            std::env::set_var(key, value);
        }
        Self { saved, _lock: lock }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..) {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }
}

/// A scratch folder, removed on drop.
struct TestDir(PathBuf);

impl TestDir {
    fn new(tag: &str) -> Self {
        let unique = format!(
            "misty-skills-hub-test-{}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
            tag
        );
        let path = std::env::temp_dir().join(unique);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A test environment with both the SSOT and the home isolated.
struct Sandbox {
    home: TestDir,
    _store: TestDir,
    _env: EnvGuard,
}

impl Sandbox {
    fn new(tag: &str) -> Self {
        let home = TestDir::new(&format!("{tag}-home"));
        let store = TestDir::new(&format!("{tag}-store"));
        let env = EnvGuard::new(&[
            ("MISTY_TEST_ENGINE_HOME", home.path()),
            ("MISTY_SKILLS_HUB_HOME", store.path()),
            // Every engine home and skills-root variable is cleared: CLAUDE_CONFIG_DIR, GROK_HOME and the
            // like set on a development machine mustn't lead test writes outside the sandbox.
            ("CLAUDE_CONFIG_DIR", &PathBuf::new()),
            ("CODEX_HOME", &PathBuf::new()),
            ("KIMI_CODE_HOME", &PathBuf::new()),
            ("GROK_HOME", &PathBuf::new()),
            ("PI_CODING_AGENT_DIR", &PathBuf::new()),
            ("OMP_CODING_AGENT_DIR", &PathBuf::new()),
            ("DSH_HOME", &PathBuf::new()),
            ("ANTIGRAVITY_HOME", &PathBuf::new()),
            ("GEMINI_DIR", &PathBuf::new()),
            ("XDG_CONFIG_HOME", &PathBuf::new()),
            ("HERMES_HOME", &PathBuf::new()),
        ]);
        Self {
            home,
            _store: store,
            _env: env,
        }
    }
}

/// Writes a skill under one of the sandbox's engine skills roots.
fn write_skill(root: &Path, directory: &str, name: &str) -> PathBuf {
    let dir = root.join(directory);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: test skill\n---\nbody\n"),
    )
    .unwrap();
    dir
}

#[test]
fn sanitize_path_segment_boundaries() {
    assert_eq!(sanitize_path_segment("pdf"), Some("pdf".to_string()));
    assert_eq!(sanitize_path_segment("  pdf  "), Some("pdf".to_string()));
    assert_eq!(
        sanitize_path_segment(".hidden"),
        Some(".hidden".to_string())
    );
    assert_eq!(sanitize_path_segment(""), None);
    assert_eq!(sanitize_path_segment("."), None);
    assert_eq!(sanitize_path_segment(".."), None);
    assert_eq!(sanitize_path_segment("a/b"), None);
    assert_eq!(sanitize_path_segment("a\\b"), None);
    assert_eq!(sanitize_path_segment("a\0b"), None);
}

#[test]
fn sanitize_relative_path_boundaries() {
    assert_eq!(sanitize_relative_path("a/b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("a\\b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("a//b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("  a/b  ").as_deref(), Some("a/b"));
    assert_eq!(sanitize_relative_path("~").as_deref(), Some("~"));
    assert_eq!(sanitize_relative_path(""), None);
    assert_eq!(sanitize_relative_path("/a/b"), None);
    assert_eq!(sanitize_relative_path("a/../b"), None);
    assert_eq!(sanitize_relative_path("a/./b"), None);
    assert_eq!(sanitize_relative_path("a:b"), None);
    assert_eq!(sanitize_relative_path("C:/x"), None);
    assert_eq!(sanitize_relative_path("C:\\x"), None);
    assert_eq!(sanitize_relative_path("\\\\server\\share"), None);
    assert_eq!(sanitize_relative_path("\\tmp"), None);
    assert_eq!(sanitize_relative_path("a\0b"), None);
    assert_eq!(sanitize_relative_path("C:foo"), None);
}

#[test]
fn sanitize_local_skill_path_rejects_dot_segments() {
    assert_eq!(sanitize_local_skill_path("a/b").as_deref(), Some("a/b"));
    assert_eq!(sanitize_local_skill_path(".hidden/x"), None);
    assert_eq!(sanitize_local_skill_path("a/.hidden"), None);
    assert_eq!(sanitize_local_skill_path("a/bad:seg"), None);
}

#[test]
fn install_name_from_directory_semantics() {
    assert_eq!(install_name_from_directory("a/b").as_deref(), Some("b"));
    assert_eq!(
        install_name_from_directory("single").as_deref(),
        Some("single")
    );
    assert_eq!(install_name_from_directory(".."), None);
    assert_eq!(install_name_from_directory("/abs"), None);
}

#[test]
fn read_yaml_field_variants() {
    assert_eq!(read_yaml_field("name: pdf-tools\n", "name"), "pdf-tools");
    assert_eq!(
        read_yaml_field("name: \"quoted name\"\n", "name"),
        "quoted name"
    );
    assert_eq!(read_yaml_field("name: 'single'\n", "name"), "single");
    assert_eq!(read_yaml_field("other: 1\n", "name"), "");
    assert_eq!(read_yaml_field("names: nope\n", "name"), "");
    assert_eq!(read_yaml_field("  name: nested\n", "name"), "nested");
    let block = "description: |\n  line one\n  line two\nname: x\n";
    assert_eq!(read_yaml_field(block, "description"), "line one line two");
    let folded = "description: >-\n  first\n\n  second\ntail: 1\n";
    assert_eq!(read_yaml_field(folded, "description"), "first  second");
}

#[test]
fn read_skill_metadata_frontmatter_and_fallback() {
    let md = "---\nname: pdf\ndescription: Extracts text from PDFs\n---\nbody\n";
    let meta = read_skill_metadata(md, "fallback");
    assert_eq!(meta.name, "pdf");
    assert_eq!(meta.description, "Extracts text from PDFs");
    let no_fm = read_skill_metadata("just body", "fallback-name");
    assert_eq!(no_fm.name, "fallback-name");
    assert_eq!(no_fm.description, "");
    let empty = read_skill_metadata("", "");
    assert_eq!(empty.name, "Skill");
    let spaced = read_skill_metadata("description: a   b\n\tc\n", "x");
    assert_eq!(spaced.description, "a b");
}

#[test]
fn skill_md_path_detection() {
    assert!(is_skill_md_path("SKILL.md"));
    assert!(is_skill_md_path("dir/SKILL.md"));
    assert!(is_skill_md_path("dir/sub/skill.md"));
    assert!(is_skill_md_path("dir/SkIlL.Md"));
    assert!(!is_skill_md_path("dir/SKILL.md.bak"));
    assert!(!is_skill_md_path("xskill.md"));
    assert_eq!(strip_skill_md_suffix("SKILL.md"), "");
    assert_eq!(strip_skill_md_suffix("dir/SKILL.md"), "dir");
    assert_eq!(strip_skill_md_suffix("dir/sub/skill.md"), "dir/sub");
    assert_eq!(strip_skill_md_suffix("dir/other.md"), "dir/other.md");
}

#[test]
fn hash_directory_stable_and_sensitive() {
    let temp = TestDir::new("hash");
    let skill = temp.path().join("skill");
    fs::create_dir_all(skill.join("sub")).unwrap();
    fs::write(skill.join("SKILL.md"), b"hello").unwrap();
    fs::write(skill.join("sub").join("a.txt"), b"aaa").unwrap();
    fs::write(skill.join(".DS_Store"), b"junk").unwrap();
    let first = hash_directory(&skill);
    assert_eq!(first, hash_directory(&skill));
    fs::write(skill.join(".DS_Store"), b"other junk").unwrap();
    assert_eq!(first, hash_directory(&skill));
    fs::write(skill.join("sub").join("a.txt"), b"aab").unwrap();
    assert_ne!(first, hash_directory(&skill));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let before = hash_directory(&skill);
        fs::set_permissions(
            skill.join("sub").join("a.txt"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert_ne!(before, hash_directory(&skill));
    }
}

/// Removing the copy synced into an engine must delete a folder link together with the link itself.
/// Windows' `remove_file` says Access denied for a folder link, which would leave
/// "copy still present" and let the next copy write through the link into the SSOT.
#[test]
fn remove_path_deletes_directory_and_dangling_symlinks() {
    let temp = TestDir::new("remove-link");
    let source = temp.path().join("source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("SKILL.md"), b"body").unwrap();

    let link = temp.path().join("linked");
    if symlink_dir(&source, &link).is_ok() {
        remove_path(&link);
        assert!(!is_symlink(&link), "link still present: {link:?}");
        assert!(source.join("SKILL.md").is_file(), "target was deleted");
    }

    let dangling = temp.path().join("dangling");
    if symlink_dir(&temp.path().join("missing"), &dangling).is_ok() {
        remove_path(&dangling);
        assert!(!is_symlink(&dangling), "dangling link still present");
    }
}

#[test]
fn source_signature_from_tree_semantics() {
    let tree = json!([
        {"type": "blob", "path": "skill/a.txt", "sha": "aaa"},
        {"type": "blob", "path": "skill/sub/b.txt", "sha": "bbb"},
        {"type": "blob", "path": "other/c.txt", "sha": "ccc"},
        {"type": "tree", "path": "skill/sub", "sha": "ddd"},
        {"type": "blob", "path": "skill/nosha"},
    ]);
    let tree = tree.as_array().unwrap();
    let signature = source_signature_from_tree(tree, "skill").unwrap();
    let mut hasher = Sha256::new();
    hasher.update("skill/a.txt:aaa\nskill/sub/b.txt:bbb");
    assert_eq!(signature, format!("{:x}", hasher.finalize()));
    assert!(source_signature_from_tree(tree, "missing").is_none());
    assert!(source_signature_from_tree(&[], "skill").is_none());
    assert!(source_signature_from_tree(tree, "").is_none());
}

#[test]
fn target_skill_path_guards() {
    let temp = TestDir::new("tsp");
    let root = temp.path().join("skills");
    assert_eq!(
        target_skill_path(&root, "a/b"),
        Some(resolve_lexical(&root.join("a").join("b")))
    );
    fs::create_dir_all(&root).unwrap();
    assert_eq!(target_skill_path(&root, "../x"), None);
    assert_eq!(target_skill_path(&root, "/etc/x"), None);
    let outside = temp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    symlink_dir(&outside, &root.join("link")).unwrap();
    assert_eq!(target_skill_path(&root, "link/x"), None);
    fs::create_dir_all(root.join("group")).unwrap();
    assert!(target_skill_path(&root, "group/x").is_some());
    let file_root = temp.path().join("file-root");
    fs::write(&file_root, b"x").unwrap();
    assert_eq!(target_skill_path(&file_root, "a"), None);
}

#[test]
fn assert_not_nested_semantics() {
    let base = Path::new("/tmp/ccgui-nest-check");
    assert!(assert_not_nested(base, base).is_ok());
    assert!(assert_not_nested(base, &base.join("child")).is_err());
    assert!(assert_not_nested(&base.join("child"), base).is_err());
    assert!(assert_not_nested(&base.join("a"), &base.join("b")).is_ok());
}

#[test]
fn classify_in_dirs_three_states() {
    let temp = TestDir::new("classify");
    let base = temp.path().join("skills");
    fs::create_dir_all(&base).unwrap();
    assert_eq!(classify_in_dirs("demo", std::slice::from_ref(&base)), "off");
    fs::create_dir_all(base.join("demo")).unwrap();
    assert_eq!(
        classify_in_dirs("demo", std::slice::from_ref(&base)),
        "synced"
    );
    fs::remove_dir_all(base.join("demo")).unwrap();
    symlink_dir(
        Path::new("/nonexistent-ccgui-test-target"),
        &base.join("demo"),
    )
    .unwrap();
    assert_eq!(
        classify_in_dirs("demo", std::slice::from_ref(&base)),
        "orphan"
    );
}

#[test]
fn classify_target_skill_with_home_env() {
    let sandbox = Sandbox::new("home");
    let claude_skills = sandbox.home.path().join(".claude").join("skills");
    fs::create_dir_all(&claude_skills).unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "off");
    fs::create_dir_all(claude_skills.join("demo")).unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "synced");
    fs::remove_dir_all(claude_skills.join("demo")).unwrap();
    symlink_dir(
        Path::new("/nonexistent-ccgui-test-target"),
        &claude_skills.join("demo"),
    )
    .unwrap();
    assert_eq!(classify_target_skill("demo", "claude"), "orphan");
    assert_eq!(classify_target_skill("demo", "bogus-target"), "off");
}

#[test]
fn registry_roundtrip_and_defaults() {
    let temp = TestDir::new("registry");
    let store = TestDir::new("registry-store");
    let _env = EnvGuard::new(&[("MISTY_SKILLS_HUB_HOME", store.path())]);
    let registry = Registry {
        repos: default_repos(),
        skills: vec![json!({"id": "o/n:dir", "directory": "dir", "targets": ["claude"]})],
    };
    save_registry(&registry).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(registry_path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert_eq!(loaded.skills.len(), 1);
    assert_eq!(
        loaded.skills[0].get("id").and_then(Value::as_str),
        Some("o/n:dir")
    );
    fs::write(registry_path(), b"not json").unwrap();
    let loaded = read_registry();
    assert!(loaded.skills.is_empty());
    assert_eq!(loaded.repos.len(), 4);
    fs::write(registry_path(), br#"{"repos":123,"skills":{}}"#).unwrap();
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert_eq!(
        loaded.repos[0].get("owner").and_then(Value::as_str),
        Some("anthropics")
    );
    assert!(loaded.skills.is_empty());
    let _ = fs::remove_file(registry_path());
    let loaded = read_registry();
    assert_eq!(loaded.repos.len(), 4);
    assert!(loaded.skills.is_empty());
    let _ = &temp;
}

#[test]
fn purge_expired_trash_ttl() {
    let store = TestDir::new("trash");
    let _env = EnvGuard::new(&[("MISTY_SKILLS_HUB_HOME", store.path())]);
    let old_stamp = now_ms() - (TRASH_TTL_MS + 60_000);
    let new_stamp = now_ms();
    let old_trash = trash_dir().join("b2xk-1");
    fs::create_dir_all(&old_trash).unwrap();
    let registry = Registry {
        repos: default_repos(),
        skills: vec![
            json!({"id": "o/n:old", "directory": "old", "trashedAt": old_stamp, "trashedDirectory": "b2xk-1"}),
            json!({"id": "o/n:new", "directory": "new", "trashedAt": new_stamp, "trashedDirectory": "bmv3-2"}),
            json!({"id": "o/n:live", "directory": "live"}),
        ],
    };
    save_registry(&registry).unwrap();
    purge_expired_trash();
    let after = read_registry();
    assert_eq!(after.skills.len(), 2);
    assert!(after
        .skills
        .iter()
        .all(|s| s.get("directory").and_then(Value::as_str) != Some("old")));
    assert!(!old_trash.exists());
}

// ===== Read-only sources and delete protection =====

#[test]
fn system_and_plugin_sources_are_listed_readonly() {
    let sandbox = Sandbox::new("readonly-scan");
    let codex_home = sandbox.home.path().join(".codex");
    write_skill(
        &codex_home.join("skills").join(".system"),
        "sys-skill",
        "sys-skill",
    );
    let plugin_dir = codex_home
        .join("plugins")
        .join("cache")
        .join("market")
        .join("p1")
        .join("1.0.0")
        .join("skills");
    write_skill(&plugin_dir, "plugin-skill", "plugin-skill");

    let skills = list_installed_skills();
    let sys = skills
        .iter()
        .find(|s| js_string(s.get("directory")) == "sys-skill")
        .expect("system skill listed");
    assert_eq!(js_string(sys.get("sourceKind")), "system");
    assert_eq!(sys.get("readonly"), Some(&json!(true)));
    let plugin = skills
        .iter()
        .find(|s| js_string(s.get("directory")) == "plugin-skill")
        .expect("plugin skill listed");
    assert_eq!(js_string(plugin.get("sourceKind")), "plugin");
    assert_eq!(plugin.get("readonly"), Some(&json!(true)));

    for directory in ["sys-skill", "plugin-skill"] {
        let error = delete_local_skill(directory, &[]).expect_err("readonly source must refuse");
        assert!(
            matches!(error, SkillError::Coded("readonly", _)),
            "got {error:?}"
        );
        let error = import_local_skill(directory, &[]).expect_err("readonly source must refuse");
        assert!(
            matches!(error, SkillError::Coded("readonly", _)),
            "got {error:?}"
        );
    }
}

#[test]
fn local_skills_are_deletable_and_managed_ones_need_uninstall() {
    let sandbox = Sandbox::new("local-delete");
    let claude_skills = sandbox.home.path().join(".claude").join("skills");
    write_skill(&claude_skills, "plain", "plain");
    write_skill(
        &sandbox.home.path().join(".codex").join("skills"),
        "plain",
        "plain",
    );

    let skills = list_installed_skills();
    let plain = skills
        .iter()
        .find(|s| js_string(s.get("directory")) == "plain")
        .expect("local skill listed");
    assert_eq!(js_string(plain.get("sourceKind")), "local");
    assert_eq!(plain.get("readonly"), Some(&json!(false)));
    assert!(scan_target_skill("plain", "codex"));

    let result = delete_local_skill("plain", &["codex".to_string()]).expect("delete");
    let results = result.get("targetResults").unwrap().as_array().unwrap();
    assert_eq!(results[0].get("ok"), Some(&json!(true)));
    assert!(!scan_target_skill("plain", "codex"));
    assert!(
        scan_target_skill("plain", "claude"),
        "claude copy untouched"
    );

    // A managed entry goes through uninstall, not delete_local.
    let store_managed = managed_skill_path("plain").unwrap();
    fs::create_dir_all(&store_managed).unwrap();
    fs::write(store_managed.join("SKILL.md"), "---\nname: plain\n---\n").unwrap();
    let mut registry = read_registry();
    registry.skills.push(json!({
        "id": "local:plain",
        "key": "local:plain",
        "directory": "plain",
        "name": "plain",
        "targets": ["claude"],
    }));
    save_registry(&registry).unwrap();
    let error = delete_local_skill("plain", &[]).expect_err("managed refuses");
    assert!(
        matches!(error, SkillError::Coded("conflict", _)),
        "got {error:?}"
    );
}

#[test]
fn unknown_targets_are_rejected_not_silently_filtered() {
    let sandbox = Sandbox::new("targets");
    let dest = managed_skill_path("demo").unwrap();
    write_skill(dest.parent().unwrap(), "demo", "demo");
    let mut registry = read_registry();
    registry.skills.push(json!({
        "id": "local:demo",
        "key": "local:demo",
        "directory": "demo",
        "name": "demo",
        "targets": [],
    }));
    save_registry(&registry).unwrap();
    let error =
        set_skill_targets("local:demo", &["bogus".to_string()]).expect_err("unknown target");
    assert!(
        matches!(error, SkillError::Coded("invalid_input", _)),
        "got {error:?}"
    );
    // Every id of the full target list is valid input (this checks the gate, not each write).
    for target in TARGETS.iter().filter(|t| t.visible) {
        validate_targets(&[target.id.to_string()]).expect(target.id);
    }
    let _ = &sandbox;
}

#[test]
fn target_list_covers_every_cli_and_reports_availability() {
    let sandbox = Sandbox::new("target-list");
    let home = sandbox.home.path();
    let list = target_list();
    let ids: Vec<&str> = list
        .iter()
        .map(|t| t.get("id").and_then(Value::as_str).unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![
            "claude",
            "codex",
            "kimi",
            "grok",
            "pi",
            "omp",
            "dsh",
            "agy",
            "gemini",
            "opencode",
            "qoder",
            "qoder-cn",
            "qwen",
            "codebuddy",
            "hermes",
        ]
    );
    // The hidden agents target stays out of the UI list.
    assert!(!ids.contains(&"agents"));
    // An empty sandbox: no engine installed.
    assert!(list
        .iter()
        .all(|t| t.get("available") == Some(&json!(false))));
    // Only a target whose home exists is available; any Antigravity home counts as installed.
    for dir in [".claude", ".grok", ".gemini/antigravity", ".qoder-cn"] {
        fs::create_dir_all(home.join(dir)).unwrap();
    }
    let available = |id: &str| {
        target_list()
            .iter()
            .find(|t| t.get("id").and_then(Value::as_str) == Some(id))
            .and_then(|t| t.get("available"))
            .and_then(Value::as_bool)
            .unwrap()
    };
    assert!(available("claude"), "claude home exists");
    assert!(available("grok"), "grok home exists");
    assert!(available("qoder-cn"), "qoder-cn home exists");
    assert!(available("agy"), "antigravity app home exists");
    assert!(!available("codex"), "no codex home");
    assert!(!available("hermes"), "no hermes home");
}

/// Each installed engine gets the managed copy in its own skills root, and removing cleans each target:
/// "every CLI supported" means sync and remove really reach each folder, not just a longer list.
#[test]
fn sync_and_remove_reach_every_engine_root() {
    let sandbox = Sandbox::new("all-engines");
    let home = sandbox.home.path();
    // Every visible target's home exists → each is an available target.
    for target in TARGETS.iter().filter(|t| t.visible) {
        for home_dir in target_home_dirs(target) {
            fs::create_dir_all(&home_dir).unwrap();
        }
    }
    let dest = managed_skill_path("demo").unwrap();
    write_skill(dest.parent().unwrap(), "demo", "demo");
    let ids: Vec<String> = TARGETS
        .iter()
        .filter(|t| t.visible)
        .map(|t| t.id.to_string())
        .collect();
    let (all_ok, results) = sync_targets_with_results("demo", &ids);
    assert!(all_ok, "every target syncs: {results:?}");
    for target in TARGETS.iter().filter(|t| t.visible) {
        assert_eq!(classify_target_skill("demo", target.id), "synced");
        for dir in target_dirs(target) {
            assert!(
                dir.join("demo").join("SKILL.md").is_file(),
                "{} missing",
                dir.display()
            );
            assert!(
                dir.starts_with(home),
                "{} escaped the sandbox",
                dir.display()
            );
        }
    }
    // The hidden agents target takes part too (`visible=false` only affects the list).
    let (agents_ok, _) = sync_targets_with_results("demo", &["agents".to_string()]);
    assert!(agents_ok);
    assert_eq!(classify_target_skill("demo", "agents"), "synced");
    let mut all_ids = ids.clone();
    all_ids.push("agents".to_string());
    let results = remove_targets_with_results("demo", &all_ids);
    assert!(
        results.iter().all(|r| r.get("ok") == Some(&json!(true))),
        "{results:?}"
    );
    for target in TARGETS.iter() {
        assert_eq!(classify_target_skill("demo", target.id), "off");
    }
}

#[test]
fn sync_target_results_report_partial_failure() {
    let store = TestDir::new("syr");
    let _env = EnvGuard::new(&[("MISTY_SKILLS_HUB_HOME", store.path())]);
    // The source doesn't exist: both targets fail, but each one's result is reported.
    let (all_ok, results) =
        sync_targets_with_results("missing-skill", &["claude".into(), "codex".into()]);
    assert!(!all_ok);
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|r| r.get("ok") == Some(&json!(false))));
    assert!(results
        .iter()
        .all(|r| r.get("error").and_then(Value::as_str).is_some()));
}

/// Removing keeps the person's own source copy: the result must say `kept`, or the UI could only
/// report "removed" while the icon is still there after a refresh.
#[test]
fn remove_reports_a_kept_user_copy_instead_of_claiming_removal() {
    let sandbox = Sandbox::new("kept");
    let claude_skills = sandbox.home.path().join(".claude").join("skills");
    let codex_skills = sandbox.home.path().join(".codex").join("skills");
    write_skill(&claude_skills, "demo", "demo");
    let skill =
        import_local_skill("demo", &["claude".to_string(), "codex".to_string()]).expect("import");
    let id = js_string(skill.get("skill").and_then(|s| s.get("id")));
    assert_eq!(classify_target_skill("demo", "codex"), "synced");

    // Every target turned off: the codex copy is deleted, claude is the person's own folder and stays.
    let removed = set_skill_targets(&id, &[]).expect("remove all");
    let results = removed
        .get("targetResults")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let entry = |target: &str| {
        results
            .iter()
            .find(|r| r.get("target").and_then(Value::as_str) == Some(target))
            .cloned()
            .unwrap_or(Value::Null)
    };
    assert_eq!(entry("codex").get("kept"), Some(&json!(false)));
    assert_eq!(entry("codex").get("ok"), Some(&json!(true)));
    assert_eq!(entry("claude").get("kept"), Some(&json!(true)));
    assert_eq!(entry("claude").get("ok"), Some(&json!(true)));
    assert!(!codex_skills.join("demo").exists());
    assert!(claude_skills.join("demo").join("SKILL.md").is_file());
}

// ===== skill usage =====

fn write_transcript(projects_dir: &Path, project: &str, file: &str, lines: &[String]) {
    let dir = projects_dir.join(project);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(file), format!("{}\n", lines.join("\n"))).unwrap();
}

fn skill_block_line(ts: &str, blocks: &[(&str, &str)], usage: &str) -> String {
    let content: Vec<String> = blocks
        .iter()
        .map(|(id, skill)| {
            format!(
                r#"{{"type":"tool_use","name":"Skill","id":"{id}","input":{{"skill":"{skill}"}}}}"#
            )
        })
        .collect();
    format!(
        r#"{{"timestamp":"{ts}","message":{{"model":"m","usage":{usage},"content":[{}]}}}}"#,
        content.join(",")
    )
}

#[test]
fn read_skill_content_reads_engine_copy_and_rejects_traversal() {
    let sandbox = Sandbox::new("content");
    let claude_skills = sandbox.home.path().join(".claude").join("skills");
    write_skill(&claude_skills, "plain", "plain");
    let payload = read_skill_content("plain").expect("content");
    assert!(js_string(payload.get("markdown")).contains("name: plain"));
    assert_eq!(payload.get("truncated"), Some(&json!(false)));
    // Absolute paths and traversal are always refused.
    let error = read_skill_content("../plain").expect_err("traversal");
    assert!(
        matches!(error, SkillError::Coded("invalid_input", _)),
        "got {error:?}"
    );
    let error = read_skill_content("/etc/passwd").expect_err("absolute");
    assert!(
        matches!(error, SkillError::Coded("invalid_input", _)),
        "got {error:?}"
    );
    let error = read_skill_content("missing").expect_err("missing");
    assert!(
        matches!(error, SkillError::Coded("not_found", _)),
        "got {error:?}"
    );
}

/// The full local lifecycle (all in scratch folders): import → sync two engines → remove one copy
/// → uninstall → restore; the person's own local source folder is never harmed.
#[test]
fn local_lifecycle_import_sync_remove_uninstall_restore() {
    let sandbox = Sandbox::new("lifecycle");
    let claude_skills = sandbox.home.path().join(".claude").join("skills");
    write_skill(&claude_skills, "demo", "demo");

    // Import and sync to two engines; the claude side keeps the person's own folder (not a managed copy).
    let imported =
        import_local_skill("demo", &["claude".to_string(), "codex".to_string()]).expect("import");
    let id = js_string(imported.get("skill").and_then(|skill| skill.get("id")));
    assert_eq!(id, "local:demo");
    assert_eq!(classify_target_skill("demo", "claude"), "synced");
    assert_eq!(classify_target_skill("demo", "codex"), "synced");
    assert!(managed_skill_path("demo").unwrap().is_dir());
    assert!(!is_symlink(&claude_skills.join("demo")));

    // Remove the codex copy: codex goes, claude's own folder is untouched.
    let updated = set_skill_targets(&id, &["claude".to_string()]).expect("set targets");
    let results = updated.get("targetResults").unwrap().as_array().unwrap();
    assert!(
        results
            .iter()
            .all(|result| result.get("ok") == Some(&json!(true))),
        "got {results:?}"
    );
    assert_eq!(classify_target_skill("demo", "codex"), "off");
    assert_eq!(classify_target_skill("demo", "claude"), "synced");

    // Uninstall: the copy the app made (codex) is removed, the managed original goes to the trash; the person's local copy stays.
    let uninstalled = uninstall_skill(&id).expect("uninstall");
    assert_eq!(uninstalled.get("trashed"), Some(&json!(true)));
    assert_eq!(classify_target_skill("demo", "codex"), "off");
    assert!(!managed_skill_path("demo").unwrap().exists());
    assert!(claude_skills.join("demo").join("SKILL.md").is_file());
    // Uninstall reports each target: the protected personal copy isn't a failure.
    let removal_results = uninstalled
        .get("targetResults")
        .unwrap()
        .as_array()
        .unwrap();
    assert!(
        removal_results
            .iter()
            .all(|result| result.get("ok") == Some(&json!(true))),
        "got {removal_results:?}"
    );

    // Restore: rebuilds the targets recorded before the uninstall (claude); it points at the person's own folder and stays as it is.
    let restored = restore_skill(&id).expect("restore");
    assert_eq!(
        js_string(restored.get("skill").and_then(|skill| skill.get("managed"))),
        "true"
    );
    assert!(managed_skill_path("demo").unwrap().is_dir());
    assert_eq!(classify_target_skill("demo", "claude"), "synced");
    assert_eq!(classify_target_skill("demo", "codex"), "off");
    assert!(claude_skills.join("demo").join("SKILL.md").is_file());
}

#[test]
fn usage_scan_dedup_share_and_last_used() {
    let home = TestDir::new("usage-home");
    let store = TestDir::new("usage-skills");
    let _env = EnvGuard::new(&[("MISTY_SKILLS_HUB_HOME", store.path())]);
    let projects = home.path().join(".claude").join("projects");

    let line_b1 = skill_block_line(
        "2026-01-02T00:00:00.000Z",
        &[("b1", "pdf")],
        r#"{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}"#,
    );
    write_transcript(&projects, "p1", "a.jsonl", std::slice::from_ref(&line_b1));
    write_transcript(
        &projects,
        "p1",
        "b.jsonl",
        &[
            line_b1,
            skill_block_line(
                "2026-01-01T00:00:00.000Z",
                &[("b2", "pdf"), ("b3", "xlsx")],
                r#"{"input_tokens":90,"output_tokens":30}"#,
            ),
            r#"{"message":{"content":[{"type":"tool_use","name":"Other"}]}}"#.to_string(),
            r#"{"name":"Skill" broken"#.to_string(),
        ],
    );

    let result = scan_skill_usage_in(&projects, false);
    assert_eq!(result.get("scannedFiles").and_then(Value::as_i64), Some(2));
    assert_eq!(
        result.get("totalInvocations").and_then(Value::as_i64),
        Some(3)
    );
    assert_eq!(result.get("cached").and_then(Value::as_bool), Some(false));
    let skills = result.get("skills").and_then(Value::as_array).unwrap();
    assert_eq!(skills.len(), 2);
    let pdf = &skills[0];
    assert_eq!(pdf.get("skill").and_then(Value::as_str), Some("pdf"));
    assert_eq!(pdf.get("invocations").and_then(Value::as_i64), Some(2));
    assert_eq!(
        pdf.get("lastUsedAt").and_then(Value::as_str),
        Some("2026-01-02T00:00:00.000Z")
    );
    let pdf_tokens = pdf.get("tokens").unwrap();
    assert_eq!(
        pdf_tokens.get("input_tokens").and_then(Value::as_i64),
        Some(145)
    );
    assert_eq!(
        pdf_tokens.get("output_tokens").and_then(Value::as_i64),
        Some(65)
    );
    assert_eq!(
        pdf_tokens.get("total_tokens").and_then(Value::as_i64),
        Some(240)
    );
    let xlsx = &skills[1];
    assert_eq!(xlsx.get("invocations").and_then(Value::as_i64), Some(1));
    assert_eq!(
        xlsx.get("tokens")
            .unwrap()
            .get("total_tokens")
            .and_then(Value::as_i64),
        Some(60)
    );

    let cached = scan_skill_usage_in(&projects, false);
    assert_eq!(cached.get("cached").and_then(Value::as_bool), Some(true));
    assert_eq!(
        cached.get("totalInvocations").and_then(Value::as_i64),
        Some(3)
    );

    write_transcript(
        &projects,
        "p1",
        "c.jsonl",
        &[skill_block_line(
            "2026-01-03T00:00:00.000Z",
            &[("b9", "pptx")],
            r#"{"input_tokens":7}"#,
        )],
    );
    let refreshed = scan_skill_usage_in(&projects, false);
    assert_eq!(
        refreshed.get("cached").and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        refreshed.get("totalInvocations").and_then(Value::as_i64),
        Some(4)
    );
    assert_eq!(
        refreshed.get("scannedFiles").and_then(Value::as_i64),
        Some(3)
    );
}

#[test]
fn usage_query_marks_scope_and_joins_installed() {
    let sandbox = Sandbox::new("usage-query");
    let projects = sandbox.home.path().join(".claude").join("projects");
    write_transcript(
        &projects,
        "p1",
        "a.jsonl",
        &[skill_block_line(
            "2026-01-02T00:00:00.000Z",
            &[("u1", "plain")],
            r#"{"input_tokens":10}"#,
        )],
    );
    write_skill(
        &sandbox.home.path().join(".claude").join("skills"),
        "plain",
        "plain",
    );

    let result = skill_usage_query(false);
    assert_eq!(
        result.get("scope").and_then(Value::as_str),
        Some(USAGE_SCOPE_CLAUDE_TRANSCRIPTS)
    );
    assert_eq!(result.get("engine").and_then(Value::as_str), Some("claude"));
    let skills = result.get("skills").and_then(Value::as_array).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].get("installed"), Some(&json!(true)));
    assert_eq!(
        skills[0].get("skillId").and_then(Value::as_str),
        Some("local:plain")
    );
}

#[test]
fn usage_missing_transcripts_reports_zero_not_fabricated() {
    let sandbox = Sandbox::new("usage-empty");
    let result = skill_usage_query(false);
    assert_eq!(result.get("scannedFiles").and_then(Value::as_i64), Some(0));
    assert_eq!(
        result.get("totalInvocations").and_then(Value::as_i64),
        Some(0)
    );
    assert!(result
        .get("skills")
        .and_then(Value::as_array)
        .map(|skills| skills.is_empty())
        .unwrap_or(false));
    let _ = &sandbox;
}

/// A skills.sh id matched to a repo folder name: the same name, without the repo prefix, or `:` to `-`;
/// no match gives None (better not_found than another skill's text in its place).
#[test]
fn resolve_skill_dir_in_tree_matches_skills_sh_ids() {
    let tree = vec![
        json!({"type": "blob", "path": "skills/web-design-guidelines/SKILL.md"}),
        json!({"type": "blob", "path": "skills/react-best-practices/SKILL.md"}),
        json!({"type": "blob", "path": "deep/nested/react-best-practices/SKILL.md"}),
        json!({"type": "blob", "path": "plugins/stitch-build/skills/react-components/SKILL.md"}),
        json!({"type": "blob", "path": "skills/react-best-practices/references/notes.md"}),
        json!({"type": "tree", "path": "skills/react-best-practices"}),
        json!({"type": "blob", "path": "README.md"}),
    ];
    let dir_for = |id: &str| resolve_skill_dir_in_tree(&tree, id).unwrap_or_default();

    assert_eq!(
        dir_for("web-design-guidelines"),
        "skills/web-design-guidelines"
    );
    // When a folder name appears in several places the shallowest wins.
    assert_eq!(
        dir_for("react-best-practices"),
        "skills/react-best-practices"
    );
    // The skills.sh id carries the repo prefix (as vercel-labs/agent-skills really does).
    assert_eq!(
        dir_for("vercel-react-best-practices"),
        "skills/react-best-practices"
    );
    // `react:components` is `react-components` in the repo.
    assert_eq!(
        dir_for("react:components"),
        "plugins/stitch-build/skills/react-components"
    );
    assert_eq!(dir_for("no-such-skill"), "");
    // A SKILL.md at the root isn't the folder matcher's job.
    assert_eq!(dir_for("skills"), "");

    // Install path: the given folder as is when it works, else the matched result.
    assert_eq!(
        resolve_existing_skill_dir(&tree, "skills/react-best-practices").unwrap_or_default(),
        "skills/react-best-practices"
    );
    assert_eq!(
        resolve_existing_skill_dir(&tree, "vercel-react-best-practices").unwrap_or_default(),
        "skills/react-best-practices"
    );
    assert_eq!(resolve_existing_skill_dir(&tree, "nope"), None);
    assert!(dir_has_skill_md(&tree, "skills/web-design-guidelines"));
    // Folders are taken by prefix (as upstream): a folder without SKILL.md isn't installable.
    assert!(!dir_has_skill_md(
        &tree,
        "skills/react-best-practices/references"
    ));
}

/// A networked smoke test (ignored by default, run by hand):
/// `cargo test --lib remote_skill_content_live -- --ignored --nocapture`
/// covers skills.sh's real shape: an id with the repo prefix (`vercel-react-best-practices`)
/// must still resolve to `skills/react-best-practices/SKILL.md` and read its front matter back.
#[ignore = "network: hits api.github.com and raw.githubusercontent.com"]
#[tokio::test]
async fn remote_skill_content_live_reads_the_repo_file() {
    let payload = remote_skill_content(
        "vercel-labs",
        "agent-skills",
        crate::known_names::DEFAULT_BRANCH,
        "vercel-react-best-practices",
    )
    .await
    .expect("remote content");
    assert_eq!(
        js_string(payload.get("path")),
        "skills/react-best-practices/SKILL.md"
    );
    assert!(
        payload
            .get("markdown")
            .and_then(Value::as_str)
            .map(|text| text.contains("name:"))
            .unwrap_or(false),
        "{payload:?}"
    );
    assert!(
        !js_string(payload.get("description")).is_empty(),
        "{payload:?}"
    );

    // A skill that really isn't in the repo must report not_found, not pick some other SKILL.md.
    let missing = remote_skill_content(
        "github",
        "awesome-copilot",
        crate::known_names::DEFAULT_BRANCH,
        "gh-cli",
    )
    .await;
    match missing.expect_err("must be not_found") {
        SkillError::Coded(code, _) => assert_eq!(code, "not_found"),
        other => panic!("unexpected error: {other:?}"),
    }
}
