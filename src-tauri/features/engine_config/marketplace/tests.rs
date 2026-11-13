use super::parse::*;
use super::parse_more::*;
use serde_json::json;
use std::path::Path;

#[test]
fn claude_listing_marks_installed_and_reads_manifests_for_the_rest() {
    let listing = json!({
        "installed": [
            { "id": "slack@claude-plugins-official", "enabled": true },
            { "id": "product-film@product-film-skill", "enabled": false,
              "installPath": "/plugins/product-film" }
        ],
        "available": [
            { "pluginId": "slack@claude-plugins-official", "name": "slack",
              "description": "Slack workspace integration.",
              "marketplaceName": "claude-plugins-official", "installCount": 111919,
              "source": { "source": "url", "url": "https://github.com/slackapi/slack-mcp-plugin.git" } },
            { "pluginId": "agent-sdk-dev@claude-plugins-official", "name": "agent-sdk-dev",
              "marketplaceName": "claude-plugins-official", "source": "./plugins/agent-sdk-dev" }
        ]
    });
    let manifest = |folder: &Path| {
        (folder == Path::new("/plugins/product-film/.claude-plugin"))
            .then(|| json!({ "name": "product-film", "description": "Make a product film." }))
    };
    let items = claude_items(&listing, &manifest);
    assert_eq!(items.len(), 3);
    let slack = &items[0];
    assert_eq!(slack.name, "Slack");
    assert!(slack.installed && slack.enabled);
    assert_eq!(slack.installs, Some(111919));
    assert_eq!(
        slack.link.as_deref(),
        Some("https://github.com/slackapi/slack-mcp-plugin")
    );
    assert_eq!(items[1].name, "Agent sdk dev");
    assert!(!items[1].installed);
    assert_eq!(items[1].link, None);
    let film = &items[2];
    assert_eq!(film.description, "Make a product film.");
    assert_eq!(film.marketplace, "product-film-skill");
    assert!(film.installed && !film.enabled);
}

#[test]
fn codex_listing_takes_names_and_sign_in_from_the_plugin() {
    let listing = json!({
        "installed": [
            { "pluginId": "pdf@openai-primary-runtime", "marketplaceName": "openai-primary-runtime",
              "installed": true, "enabled": true, "authPolicy": "ON_USE",
              "source": { "source": "local", "path": "/runtime/pdf" } }
        ],
        "available": [
            { "pluginId": "gmail@openai-curated", "marketplaceName": "openai-curated",
              "installed": false, "enabled": false, "authPolicy": "ON_INSTALL",
              "source": { "source": "local", "path": "/curated/gmail" } },
            { "pluginId": "pdf@openai-primary-runtime", "installed": true,
              "source": { "source": "local", "path": "/runtime/pdf" } }
        ]
    });
    let manifest = |folder: &Path| {
        (folder == Path::new("/curated/gmail/.codex-plugin")).then(|| {
            json!({
                "description": "Work with Gmail.",
                "interface": { "displayName": "Gmail", "shortDescription": "Read and manage Gmail",
                               "category": "Communication",
                               "websiteURL": "https://workspace.google.com/products/gmail/" }
            })
        })
    };
    let items = codex_items(&listing, &manifest);
    assert_eq!(
        items.len(),
        2,
        "an installed plugin listed twice shows once"
    );
    assert_eq!(items[0].name, "Pdf");
    assert_eq!(items[0].sign_in.as_deref(), Some("on_use"));
    let gmail = &items[1];
    assert_eq!(gmail.name, "Gmail");
    assert_eq!(gmail.description, "Read and manage Gmail");
    assert_eq!(gmail.category.as_deref(), Some("Communication"));
    assert_eq!(gmail.sign_in.as_deref(), Some("on_install"));
    assert!(!gmail.installed);
}

#[test]
fn sources_name_where_each_marketplace_comes_from() {
    let claude = claude_sources(&json!([
        { "name": "claude-plugins-official", "source": "github", "repo": "anthropics/claude-plugins-official" },
        { "name": "film", "source": "git", "url": "https://github.com/a/b.git" }
    ]));
    assert_eq!(claude[0].location, "anthropics/claude-plugins-official");
    assert_eq!(claude[1].location, "https://github.com/a/b.git");
    let codex = codex_sources(&json!({ "marketplaces": [
        { "name": "openai-curated", "root": "/codex/.tmp/plugins" },
        { "name": "bundled", "root": "/x", "marketplaceSource": { "source": "/bundled" } }
    ]}));
    assert_eq!(codex[0].location, "/codex/.tmp/plugins");
    assert_eq!(codex[1].location, "/bundled");
}

#[test]
fn claude_connectors_keep_names_and_states_but_never_addresses() {
    let output = "Checking MCP server health…\n\n\
        claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\n\
        plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication\n\
        plugin:design:gmail:  (HTTP) - - Not configured\n\
        local-db: npx db-server --token=abc - ✗ Failed to connect\n";
    let connectors = claude_connectors(output);
    assert_eq!(connectors.len(), 4);
    assert_eq!(
        (
            connectors[0].name.as_str(),
            connectors[0].origin.as_str(),
            connectors[0].state.as_str()
        ),
        ("Gmail", "account", "connected")
    );
    assert_eq!(
        (
            connectors[1].name.as_str(),
            connectors[1].origin.as_str(),
            connectors[1].state.as_str()
        ),
        ("Slack", "plugin", "needs_sign_in")
    );
    assert_eq!(connectors[2].state, "off");
    assert_eq!(
        (connectors[3].origin.as_str(), connectors[3].state.as_str()),
        ("config", "failed")
    );
    let serialized = serde_json::to_string(&connectors).unwrap();
    assert!(!serialized.contains("https://") && !serialized.contains("token"));
}

#[test]
fn omp_text_lists_read_with_colour_codes_and_installed_marks() {
    let sources = omp_sources(
        "\u{1b}[1mConfigured Marketplaces:\n\u{1b}[22m\n  \u{1b}[36mclaude-plugins-official\u{1b}[39m  \u{1b}[2mhttps://github.com/anthropics/claude-plugins-official\u{1b}[22m\n",
    );
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].name, "claude-plugins-official");
    assert_eq!(
        sources[0].location,
        "https://github.com/anthropics/claude-plugins-official"
    );

    let mut items = omp_available(
        "Available Plugins (official):\n\n  slack@1.2.0\n    Slack workspace integration.\n  agent-sdk-dev\n",
        "official",
    );
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "slack@official");
    assert_eq!(items[0].description, "Slack workspace integration.");
    assert_eq!(items[1].id, "agent-sdk-dev@official");

    omp_mark_installed(
        &mut items,
        &json!({ "npm": [], "marketplace": [
            { "id": "slack@official", "scope": "user", "entries": [{ "version": "1.2.0" }] },
            { "id": "gone@elsewhere", "scope": "user", "entries": [{ "enabled": false }] }
        ]}),
    );
    assert!(items[0].installed && items[0].enabled);
    assert!(!items[1].installed);
    let gone = items
        .iter()
        .find(|item| item.id == "gone@elsewhere")
        .unwrap();
    assert!(gone.installed && !gone.enabled);
}

#[test]
fn loose_listings_read_arrays_and_claude_style_objects() {
    let object = loose_items(
        "qoder",
        &json!({
            "installed": [{ "id": "review@official", "enabled": true }],
            "available": [
                { "pluginId": "review@official", "description": "Reviews code." },
                { "name": "docs", "marketplace": "official", "installCount": 12 },
                { "name": "no-marketplace" }
            ]
        }),
    );
    assert_eq!(
        object.len(),
        2,
        "an entry without a marketplace can't install"
    );
    assert!(object[0].installed && object[0].enabled);
    assert_eq!(object[1].id, "docs@official");
    assert_eq!(object[1].installs, Some(12));

    let array = loose_items(
        "minimax",
        &json!([{ "id": "lint@official", "installed": true, "description": "Lints." }]),
    );
    assert_eq!(array[0].engine, "minimax");
    assert!(array[0].installed);

    let sources = loose_sources(&json!({ "marketplaces": [
        { "name": "official", "source": { "source": "github", "repo": "qoder/plugins" } }
    ]}));
    assert_eq!(sources[0].location, "qoder/plugins");
}

#[test]
fn the_gallery_marks_installed_extensions_and_keeps_the_rest() {
    let gallery = json!([
        { "url": "https://github.com/obra/superpowers", "fullName": "obra/superpowers",
          "extensionName": "superpowers", "extensionDescription": "Core skills library",
          "stars": 299294 },
        { "url": "https://github.com/a/b", "fullName": "a/b", "extensionName": "b-tools",
          "repoDescription": "Tools" },
        { "url": "http://insecure.example/x", "extensionName": "x" }
    ]);
    let installed = vec![
        InstalledExtension {
            name: "b-tools".into(),
            description: String::new(),
            source: None,
        },
        InstalledExtension {
            name: "local-thing".into(),
            description: "Mine".into(),
            source: Some("/Users/me/thing".into()),
        },
    ];
    let items = gallery_items("gemini", &gallery, &installed);
    assert_eq!(items.len(), 3, "an address that isn't GitHub stays out");
    assert_eq!(items[0].id, "https://github.com/obra/superpowers");
    assert_eq!(items[0].stars, Some(299294));
    assert!(!items[0].installed);
    assert_eq!(
        items[1].id, "b-tools",
        "an installed extension removes by name"
    );
    assert!(items[1].installed);
    assert_eq!(items[2].id, "local-thing");
    assert_eq!(items[2].link, None);

    assert!(valid_gallery_url("https://github.com/obra/superpowers"));
    assert!(!valid_gallery_url("https://github.com/obra"));
    assert!(!valid_gallery_url(
        "https://github.com/obra/superpowers/tree/main"
    ));
    assert!(!valid_gallery_url("https://example.com/obra/superpowers"));
    assert!(!valid_gallery_url("https://github.com/-x/y"));
}

#[test]
fn only_plain_ids_names_and_sources_reach_a_command_line() {
    assert!(valid_id("gmail@openai-curated"));
    assert!(valid_id(
        "42crunch-api-security-testing@claude-plugins-official"
    ));
    assert!(!valid_id("gmail"));
    assert!(!valid_id("--help@x"));
    assert!(!valid_id("a b@c"));
    assert!(!valid_id("a@../c"));
    assert!(valid_name("product-film-skill"));
    assert!(!valid_name("-x"));
    assert!(valid_source("anthropics/claude-plugins-official"));
    assert!(valid_source("https://github.com/a/b.git"));
    assert!(valid_source("/Users/me/marketplace"));
    assert!(!valid_source("--registry=evil"));
    assert!(!valid_source("a/b/c"));
    assert!(!valid_source("http://insecure.example/x"));
    assert!(!valid_source("https://x y"));
}

#[test]
fn a_claude_install_that_needs_its_command_seen_says_so() {
    let output = "progress\n{\"command\":\"install\",\"outcome\":\"needs_confirmation\",\
        \"shownCommand\":{\"command\":\"xcrun agent plugin path\",\"sha256\":\"abc\"}}\n";
    let result = last_json_line(output).unwrap();
    let shown = shown_command(&result).unwrap();
    assert_eq!(shown.command, "xcrun agent plugin path");
    assert_eq!(shown.sha256, "abc");
    let failed = last_json_line("{\"outcome\":\"failed\",\"message\":\"not found\"}").unwrap();
    assert!(shown_command(&failed).is_none());
}

/// Reads output recorded from the real CLIs, never the CLIs themselves (tests run in an empty
/// home): save `claude plugin list --json --available` as claude-plugins.json, its
/// `plugin marketplace list --json` as claude-sources.json, the same two from Codex as
/// codex-plugins.json and codex-sources.json, and `claude mcp list` as claude-mcp.txt, then run
/// `MARKET_SAMPLES=<folder> cargo test --lib -- --ignored market_samples --nocapture`.
#[test]
#[ignore]
fn market_samples() {
    let folder = std::path::PathBuf::from(std::env::var("MARKET_SAMPLES").expect("MARKET_SAMPLES"));
    let read = |name: &str| std::fs::read_to_string(folder.join(name)).expect(name);
    let json = |engine: &str, name: &str| super::parse_json(engine, &read(name)).expect(name);
    let manifest = |dir: &Path| {
        let bytes = std::fs::read(dir.join("plugin.json")).ok()?;
        serde_json::from_slice(&bytes).ok()
    };
    for (engine, items, sources) in [
        (
            "claude",
            claude_items(&json("claude", "claude-plugins.json"), &manifest),
            claude_sources(&json("claude", "claude-sources.json")),
        ),
        (
            "codex",
            codex_items(&json("codex", "codex-plugins.json"), &manifest),
            codex_sources(&json("codex", "codex-sources.json")),
        ),
    ] {
        let installed = items.iter().filter(|item| item.installed).count();
        let described = items
            .iter()
            .filter(|item| !item.description.is_empty())
            .count();
        let linked = items.iter().filter(|item| item.link.is_some()).count();
        println!(
            "{engine}: {} plugins, {installed} installed, {described} described, {linked} linked, {} sources",
            items.len(),
            sources.len()
        );
        assert!(
            items.iter().all(|item| valid_id(&item.id)),
            "every id installs"
        );
        for item in items
            .iter()
            .filter(|item| item.installed || item.id.starts_with("gmail@"))
        {
            println!("  {} | {} | {}", item.id, item.name, item.description);
        }
    }
    for connector in claude_connectors(&read("claude-mcp.txt")) {
        println!(
            "  connector {} | {} | {}",
            connector.name, connector.origin, connector.state
        );
    }
}
