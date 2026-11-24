use super::parse::*;

#[tokio::test]
#[ignore = "runs the installed engine CLIs"]
async fn live_every_engine_lists_its_marketplace() {
    let home = std::env::var_os("MISTY_LIVE_HOME").expect("set MISTY_LIVE_HOME to the real home");
    // SAFETY: the live tests run on their own (`--ignored`, filtered to them), before any thread
    // reads the environment.
    unsafe {
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
    }
    crate::engine_config::support::allow_engine_config_locations();
    let mut broken = Vec::new();
    for engine in super::ENGINES {
        if !on_path(engine) {
            println!("absent  {engine}");
            continue;
        }
        let (items, sources) = match super::list_engine(engine).await {
            Ok(listing) => listing,
            Err(error) => {
                println!("BROKEN  {engine}: {error}");
                broken.push(format!("{engine}: {error}"));
                continue;
            }
        };
        let installed: Vec<&str> = items
            .iter()
            .filter(|item| item.installed)
            .map(|item| item.id.as_str())
            .collect();
        println!(
            "ok      {engine}: {} plugins, {} sources, installed {installed:?}",
            items.len(),
            sources.len()
        );
        let bare: Vec<&str> = items
            .iter()
            .filter(|item| item.installed && item.description.is_empty())
            .map(|item| item.id.as_str())
            .collect();
        if !bare.is_empty() {
            broken.push(format!("{engine}: installed with no description {bare:?}"));
        }
        let described = items
            .iter()
            .filter(|item| !item.description.is_empty())
            .count();
        println!("        {described} of {} have a description", items.len());
        if items.is_empty() && !sources.is_empty() {
            broken.push(format!("{engine}: has marketplaces but listed no plugins"));
        }
        if let Some((want_installed, want_sources)) = cli_counts(engine).await {
            if installed.len() != want_installed {
                broken.push(format!(
                    "{engine}: the CLI has {want_installed} installed, Misty read {}",
                    installed.len()
                ));
            }
            if sources.len() != want_sources {
                broken.push(format!(
                    "{engine}: the CLI has {want_sources} marketplaces, Misty read {}",
                    sources.len()
                ));
            }
        }
    }
    match super::run_ok("claude", &["mcp", "list"], super::CONNECTORS_LIMIT).await {
        Ok(output) => {
            let connectors = claude_connectors(&output);
            let printed = output
                .lines()
                .filter(|line| line.contains(": ") && line.contains(" - "))
                .count();
            println!(
                "ok      claude connectors: {} of {printed}",
                connectors.len()
            );
            for connector in &connectors {
                println!(
                    "        {} ({}, {})",
                    connector.name, connector.origin, connector.state
                );
            }
            if connectors.len() != printed {
                broken.push(format!(
                    "claude connectors: `mcp list` printed {printed}, Misty read {}",
                    connectors.len()
                ));
            }
        }
        Err(error) => broken.push(format!("claude connectors: {error}")),
    }
    assert!(broken.is_empty(), "broken engines:\n{}", broken.join("\n"));
}

type Throwaway = (
    &'static str,
    &'static str,
    Option<(&'static str, &'static str)>,
);

#[tokio::test]
#[ignore = "installs and removes plugins in the installed engine CLIs"]
async fn live_install_and_remove_in_every_engine() {
    let home = std::env::var_os("MISTY_LIVE_HOME").expect("set MISTY_LIVE_HOME to the real home");
    // SAFETY: as in the listing test.
    unsafe {
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
    }
    crate::engine_config::support::allow_engine_config_locations();
    const CLAUDE_MD: &str = "claude-md-management@claude-plugins-official";
    let throwaway: &[Throwaway] = &[
        ("claude", CLAUDE_MD, None),
        ("codex", "build-web-data-visualization@openai-curated", None),
    ];
    let mut broken = Vec::new();
    for &(engine, id, source) in throwaway {
        if !on_path(engine) {
            println!("absent  {engine}");
            continue;
        }
        let find = || async move {
            super::list_engine(engine).await.map(|(items, sources)| {
                let item = items
                    .into_iter()
                    .find(|item| item.id == id || item.link.as_deref() == Some(id));
                (item, sources)
            })
        };
        let mut added = None;
        if let Some((location, name)) = source {
            match super::add_source(engine, location).await {
                Ok(()) => {
                    println!("ok      {engine}: added marketplace {location}");
                    added = Some(name);
                }
                Err(error) => {
                    broken.push(format!("{engine}: adding marketplace failed: {error}"));
                    continue;
                }
            }
            match find().await {
                Ok((_, sources)) if sources.iter().any(|source| source.name == name) => {
                    println!("ok      {engine}: listing shows marketplace {name}")
                }
                other => broken.push(format!(
                    "{engine}: after adding, the marketplaces were {:?}",
                    other.map(|(_, sources)| sources)
                )),
            }
        }
        test_one_install(engine, id, &find, &mut broken).await;
        if let Some(name) = added {
            match super::remove_source(engine, name).await {
                Ok(()) => println!("ok      {engine}: removed marketplace {name}"),
                Err(error) => broken.push(format!(
                    "{engine}: removing marketplace failed: {error} (remove {name} by hand)"
                )),
            }
            match find().await {
                Ok((_, sources)) if sources.iter().all(|source| source.name != name) => {
                    println!("ok      {engine}: listing shows marketplace {name} gone")
                }
                other => broken.push(format!(
                    "{engine}: after removing, the marketplaces were {:?}",
                    other.map(|(_, sources)| sources)
                )),
            }
        }
    }
    assert!(broken.is_empty(), "broken:\n{}", broken.join("\n"));
}

async fn test_one_install<F, Fut>(
    engine: &'static str,
    id: &str,
    find: &F,
    broken: &mut Vec<String>,
) where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(Option<MarketItem>, Vec<MarketSource>), String>>,
{
    match find().await {
        Ok((Some(item), _)) if item.installed => {
            broken.push(format!(
                "{engine}: {id} was already installed; pick another"
            ));
            return;
        }
        Ok((Some(_), _)) => {}
        Ok((None, _)) => {
            broken.push(format!("{engine}: the listing doesn't offer {id}"));
            return;
        }
        Err(error) => {
            broken.push(format!("{engine}: listing failed: {error}"));
            return;
        }
    }
    match super::install(engine, id, None).await {
        Ok(super::InstallOutcome::Installed) => println!("ok      {engine}: installed {id}"),
        Ok(super::InstallOutcome::ConfirmCommand { command }) => {
            broken.push(format!("{engine}: {id} asked to confirm {command:?}"));
            return;
        }
        Err(error) => {
            broken.push(format!("{engine}: install failed: {error}"));
            return;
        }
    }
    let listed = match find().await {
        Ok((Some(item), _)) if item.installed => {
            println!("ok      {engine}: listing shows {} installed", item.id);
            item.id
        }
        other => {
            broken.push(format!(
                "{engine}: after install the listing said {:?} (remove {id} by hand)",
                other.map(|(item, _)| item)
            ));
            return;
        }
    };
    match super::remove(engine, &listed).await {
        Ok(()) => println!("ok      {engine}: removed {listed}"),
        Err(error) => {
            broken.push(format!(
                "{engine}: remove failed: {error} (remove {listed} by hand)"
            ));
            return;
        }
    }
    match find().await {
        Ok((item, _)) if !item.as_ref().is_some_and(|item| item.installed) => {
            println!("ok      {engine}: listing shows {id} gone")
        }
        other => broken.push(format!(
            "{engine}: after remove the listing said {:?}",
            other.map(|(item, _)| item)
        )),
    }
}

async fn cli_counts(engine: &str) -> Option<(usize, usize)> {
    let count = |value: &serde_json::Value, key: &str| {
        value[key]
            .as_array()
            .or_else(|| value.as_array())
            .map_or(0, Vec::len)
    };
    let (list, sources) = match engine {
        "claude" | "codex" => (
            vec!["plugin", "list", "--json"],
            vec!["plugin", "marketplace", "list", "--json"],
        ),
        _ => return None,
    };
    let list = super::run_ok(engine, &list, super::LIST_LIMIT).await.ok()?;
    let list = super::parse_json(engine, &list).ok()?;
    let installed = match &list {
        serde_json::Value::Array(entries) => entries.len(),
        value => count(value, "installed"),
    };
    let sources = super::run_ok(engine, &sources, super::LIST_LIMIT)
        .await
        .ok()?;
    let sources = super::parse_json(engine, &sources).ok()?;
    Some((installed, count(&sources, "marketplaces")))
}

fn on_path(engine: &str) -> bool {
    std::process::Command::new("which")
        .arg(super::super::cli_lifecycle::engine_bin(engine))
        .output()
        .is_ok_and(|output| output.status.success())
}
