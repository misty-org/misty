// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
#![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.
use super::*;
use std::fs;

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("misty-slash-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn names(found: &[Found]) -> Vec<&str> {
    found.iter().map(|entry| entry.name.as_str()).collect()
}

#[test]
fn reads_descriptions_from_front_matter_or_first_line() {
    assert_eq!(
        description_of("---\nname: x\ndescription: \"Does a thing\"\n---\nBody"),
        "Does a thing"
    );
    assert_eq!(
        description_of("# Review the diff\n\nMore"),
        "Review the diff"
    );
    assert_eq!(description_of(""), "");
}

#[test]
fn lists_user_and_project_items_and_prefers_the_project() {
    // catalog_for follows CLAUDE_CONFIG_DIR and CODEX_HOME, which other tests steer.
    let _env = crate::engine_config::support::HOME_ENV_LOCK.lock();
    let root = std::env::temp_dir().join(format!("misty-catalog-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let home = root.join("home");
    let project = root.join("project");
    std::fs::create_dir_all(home.join(".claude/commands/git")).unwrap();
    std::fs::create_dir_all(home.join(".claude/skills/pdf")).unwrap();
    std::fs::create_dir_all(project.join(".claude/commands")).unwrap();
    std::fs::write(home.join(".claude/commands/ship.md"), "Ship it").unwrap();
    std::fs::write(home.join(".claude/commands/git/sync.md"), "Sync").unwrap();
    std::fs::write(project.join(".claude/commands/ship.md"), "Ship here").unwrap();
    std::fs::write(
        home.join(".claude/skills/pdf/SKILL.md"),
        "---\ndescription: Read PDFs\n---\n",
    )
    .unwrap();
    let catalog = catalog_for("claude", &home, Some(&project));
    let ship = catalog.commands.iter().find(|c| c.name == "ship").unwrap();
    assert_eq!(
        (ship.source, ship.description.as_str()),
        ("project", "Ship here")
    );
    assert!(catalog
        .commands
        .iter()
        .any(|c| c.name == "git:sync" && c.insert == "/git:sync "));
    assert!(catalog.commands.iter().any(|c| c.name == "compact"));
    assert_eq!(catalog.skills[0].insert, "/pdf ");
    let codex = catalog_for("codex", &home, None);
    assert!(codex.skills.is_empty());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn derives_namespaced_names_from_directories() {
    let root = scratch_dir("derive");
    let nested = root.join("aimax");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("plan.md"), "# Plan\n").unwrap();
    fs::write(root.join("commit.md"), "# Commit\n").unwrap();
    fs::write(root.join("README.md"), "docs, not a command").unwrap();
    fs::write(root.join("notes.txt"), "not markdown").unwrap();

    let entries = discover_commands_in(&root, &root, "project");
    assert_eq!(names(&entries), vec!["aimax:plan", "commit"]);
}

#[test]
fn frontmatter_overrides_name_and_carries_description() {
    let root = scratch_dir("frontmatter");
    fs::write(
        root.join("x.md"),
        "---\nname: custom:run\ndescription: \"Run the flow\"\nargument-hint: [target]\n---\nbody\n",
    )
    .unwrap();
    let entries = discover_commands_in(&root, &root, "user");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "custom:run");
    assert_eq!(entries[0].description, "Run the flow");
    assert_eq!(entries[0].argument_hint.as_deref(), Some("[target]"));
}

#[test]
fn project_shadows_user_on_name_collision() {
    let item = |name: &str, source: &'static str| CatalogItem {
        name: name.into(),
        description: source.into(),
        source,
        insert: format!("/{name} "),
        argument_hint: None,
    };
    let merged = unique(vec![item("Plan", "user"), item("plan", "project")]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].description, "project");
}

#[test]
fn discovers_skills_from_skill_md_directories() {
    let root = scratch_dir("skills");
    let review = root.join("code-review");
    fs::create_dir_all(&review).unwrap();
    fs::write(
        review.join("SKILL.md"),
        "---\ndescription: \"Review code\"\n---\nbody\n",
    )
    .unwrap();
    let named = root.join("renamed");
    fs::create_dir_all(&named).unwrap();
    fs::write(named.join("SKILL.md"), "---\nname: custom-skill\n---\n").unwrap();
    fs::create_dir_all(root.join("no-manifest")).unwrap();
    fs::write(root.join("loose.md"), "not a skill dir").unwrap();

    let entries = discover_skills_in(&root, "project");
    assert_eq!(names(&entries), vec!["code-review", "custom-skill"]);
    assert_eq!(entries[0].description, "Review code");
    assert!(entries.iter().all(|e| e.argument_hint.is_none()));
}

#[test]
fn collects_plugin_skills_dirs_at_any_nesting() {
    let root = scratch_dir("plugin-cache");
    let cache = root.join("plugins").join("cache");
    // Two layouts seen in the wild: cache/<plugin>/<version>/skills and
    // cache/<marketplace>/<plugin>/<version>/skills.
    let flat = cache.join("gsd").join("1.2.0").join("skills");
    let nested = cache
        .join("market")
        .join("aimax")
        .join("0.3.1")
        .join("skills");
    fs::create_dir_all(&flat).unwrap();
    fs::create_dir_all(&nested).unwrap();
    // A `skills` file (not a folder) and a version folder without skills are ignored.
    fs::write(cache.join("gsd").join("skills"), "not a dir").unwrap();
    fs::create_dir_all(cache.join("empty").join("9.9.9")).unwrap();

    let dirs = codex_plugin_skills_dirs(&root);
    let paths: Vec<&Path> = dirs.iter().map(|(p, _)| p.as_path()).collect();
    assert_eq!(paths, vec![flat.as_path(), nested.as_path()]);
    assert!(dirs.iter().all(|(_, source)| *source == "plugin"));
    assert!(codex_plugin_skills_dirs(&root.join("missing")).is_empty());
}

#[test]
fn parses_multiline_block_scalar_description() {
    let content = "---\nname: lint-fix\ndescription: >\n  Fixes lint errors in codebase.\n  Do not use for general review.\n---\nbody\n";
    let (name, description, hint) = parse_command_frontmatter(content);
    assert_eq!(name.as_deref(), Some("lint-fix"));
    assert_eq!(
        description.as_deref(),
        Some("Fixes lint errors in codebase. Do not use for general review.")
    );
    assert_eq!(hint, None);
}

#[test]
fn parses_literal_block_scalar_description() {
    let content =
        "---\nname: multi-step\ndescription: |\n  Step 1: analyze\n  Step 2: execute\n---\nbody\n";
    let (name, description, hint) = parse_command_frontmatter(content);
    assert_eq!(name.as_deref(), Some("multi-step"));
    assert_eq!(
        description.as_deref(),
        Some("Step 1: analyze\nStep 2: execute")
    );
    assert_eq!(hint, None);
}

#[test]
fn discovers_system_skills_via_recursion() {
    let root = scratch_dir("codex-skills");
    let sys_skill = root.join(".system").join("analytics-template");
    fs::create_dir_all(&sys_skill).unwrap();
    fs::write(
        sys_skill.join("SKILL.md"),
        "---\ndescription: \"System analytics skill\"\n---\n",
    )
    .unwrap();

    let entries = discover_skills_in(&root, "user");
    assert_eq!(names(&entries), vec!["analytics-template"]);
    assert_eq!(entries[0].source, "user");
}

#[test]
fn discovers_nested_category_skills() {
    let root = scratch_dir("nested-skills");
    let nested = root.join("analytics").join("dashboard");
    fs::create_dir_all(&nested).unwrap();
    fs::write(
        nested.join("SKILL.md"),
        "---\ndescription: \"Analytics dashboard template\"\n---\n",
    )
    .unwrap();

    let entries = discover_skills_in(&root, "project");
    assert_eq!(names(&entries), vec!["dashboard"]);
    assert_eq!(entries[0].description, "Analytics dashboard template");
}

#[test]
fn codex_reads_project_agents_codex_and_plugin_skills() {
    // catalog_for follows CLAUDE_CONFIG_DIR and CODEX_HOME, which other tests steer.
    let _env = crate::engine_config::support::HOME_ENV_LOCK.lock();
    let root = scratch_dir("codex-catalog");
    let home = root.join("home");
    let project = root.join("project");
    for (dir, file) in [
        (project.join(".agents/skills/agent-worker"), "SKILL.md"),
        (project.join(".codex/skills/codex-worker"), "skill.md"),
        (
            home.join(".codex/plugins/cache/gsd/1.0.0/skills/plugin-worker"),
            "SKILL.md",
        ),
        (home.join(".agents/skills/shared-worker"), "SKILL.md"),
    ] {
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(file), "---\ndescription: \"worker\"\n---\n").unwrap();
    }
    fs::create_dir_all(project.join(".codex/commands")).unwrap();
    fs::write(project.join(".codex/commands/codex-test.md"), "# Test\n").unwrap();
    let catalog = catalog_for("codex", &home, Some(&project));
    let skills: Vec<(&str, &str)> = catalog
        .skills
        .iter()
        .map(|skill| (skill.name.as_str(), skill.source))
        .collect();
    assert_eq!(
        skills,
        vec![
            ("agent-worker", "project"),
            ("codex-worker", "project"),
            ("plugin-worker", "user"),
            ("shared-worker", "user"),
        ]
    );
    assert!(catalog
        .skills
        .iter()
        .all(|skill| skill.insert.starts_with('$')));
    assert!(catalog
        .commands
        .iter()
        .any(|c| c.name == "codex-test" && c.source == "project"));
}

#[test]
fn other_engines_read_the_shared_layouts() {
    // catalog_for follows CLAUDE_CONFIG_DIR and CODEX_HOME, which other tests steer.
    let _env = crate::engine_config::support::HOME_ENV_LOCK.lock();
    let ws = scratch_dir("shared-layouts");
    let home = ws.join("home");
    let project = ws.join("project");
    for dir in [
        project.join(".agents/skills/agent-worker"),
        project.join(".skills/hidden-worker"),
        project.join("skills/visible-worker"),
        project.join(".agent/skills/pi-worker"),
    ] {
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "---\n---\n").unwrap();
    }
    fs::create_dir_all(project.join(".agents/commands")).unwrap();
    fs::write(
        project.join(".agents/commands/agent-deploy.md"),
        "# Deploy\n",
    )
    .unwrap();
    let catalog = catalog_for("pi", &home, Some(&project));
    let skills: Vec<&str> = catalog.skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        skills,
        vec![
            "agent-worker",
            "hidden-worker",
            "pi-worker",
            "visible-worker"
        ]
    );
    assert!(catalog.skills.iter().all(|s| s.source == "project"));
    assert_eq!(catalog.commands[0].name, "agent-deploy");
}
