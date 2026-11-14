//! `/apps` and `/plugins`: the ChatGPT apps installed for Codex, and its plugins, listed,
//! shown, installed and removed.

use super::*;

/// pages through all of it, thousands of apps on codex 0.147, in no order but their names.
pub(super) async fn apps(context: &Context) -> Result<Output, String> {
    let mut rpc = open(context).await?;
    let mut scope = json!({});
    if let Some(thread) = loaded_thread(&mut rpc, context).await {
        scope["threadId"] = json!(thread);
    }
    let installed = rpc.call("app/installed", scope).await.map_err(text);
    rpc.stop().await;
    let installed = installed?;
    let rows: Vec<Row> = installed["apps"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|app| {
            let name = text_at(app, "/runtimeName")
                .or_else(|| text_at(app, "/id"))
                .unwrap_or("app");
            let state = match (app["enabled"].as_bool(), app["callable"].as_bool()) {
                (Some(false), _) => "off",
                (_, Some(false)) => "on, not callable",
                _ => "on",
            };
            row(name, state)
        })
        .collect();
    let more = format!("Add more from [ChatGPT's app directory]({APP_DIRECTORY}).");
    Ok(Output::info(
        "Apps",
        vec![Section {
            heading: Some("Installed".into()),
            text: Some(if rows.is_empty() {
                format!("No apps are installed. {more}")
            } else {
                more
            }),
            rows,
        }],
    ))
}

/// Plugins. Codex's online catalog (`openai-curated-remote`) is searched, never listed: listed
/// whole it holds thousands of plugins, tens of megabytes in one reply on codex 0.147, more than
/// a reply may be. The listing shows the local marketplaces and what is installed from any.
pub(super) async fn plugins(context: &Context) -> Result<Output, String> {
    let args = context.args.trim();
    let (verb, rest) = split_first(args);
    let scope = match folder(context) {
        Some(folder) => json!({ "cwds": [folder] }),
        None => json!({}),
    };
    let mut rpc = open(context).await?;
    let result = match verb {
        "" => plugin_overview(&mut rpc, &scope).await,
        "install" | "uninstall" if rest.is_empty() => Err(format!(
            "Write the plugin after the command: /plugins {verb} <plugin>"
        )),
        "install" => plugin_install(&mut rpc, &scope, rest).await,
        "uninstall" => plugin_uninstall(&mut rpc, &scope, rest).await,
        plugin => plugin_details(&mut rpc, &scope, plugin).await,
    };
    rpc.stop().await;
    result
}

/// `plugin/list` of the local marketplaces only, leaving out the online catalog.
async fn local_plugins(rpc: &mut Session, scope: &Value) -> Result<Value, String> {
    let mut params = scope.clone();
    params["marketplaceKinds"] = json!(["local"]);
    rpc.call("plugin/list", params).await.map_err(text)
}

async fn plugin_overview(rpc: &mut Session, scope: &Value) -> Result<Output, String> {
    let local = local_plugins(rpc, scope).await?;
    let installed = rpc
        .call("plugin/installed", scope.clone())
        .await
        .map_err(text)?;
    Ok(plugin_listing(&local, &installed))
}

fn plugin_listing(local: &Value, installed: &Value) -> Output {
    let local_names: Vec<&str> = local["marketplaces"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|marketplace| marketplace["name"].as_str())
        .collect();
    // The local marketplaces whole, then what is installed from the others (the catalog).
    let remote_installed = installed["marketplaces"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|marketplace| {
            !local_names.contains(&marketplace["name"].as_str().unwrap_or_default())
        });
    let mut sections = Vec::new();
    for marketplace in local["marketplaces"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(remote_installed)
    {
        let rows: Vec<Row> = marketplace["plugins"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|plugin| {
                let state = match (plugin["installed"].as_bool(), plugin["enabled"].as_bool()) {
                    (Some(true), Some(false)) => "installed, off",
                    (Some(true), _) => "installed",
                    _ => "available",
                };
                let value = match text_at(plugin, "/interface/shortDescription") {
                    Some(about) => format!("{state} · {}", short(about, 100)),
                    None => state.to_string(),
                };
                row(plugin["id"].as_str().unwrap_or("plugin"), value)
            })
            .collect();
        if rows.is_empty() {
            continue;
        }
        let name = text_at(marketplace, "/interface/displayName")
            .or_else(|| text_at(marketplace, "/name"))
            .unwrap_or("Marketplace");
        sections.push(heading_rows(name, rows));
    }
    let errors: Vec<String> = local["marketplaceLoadErrors"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|error| format!("- {}", error["message"].as_str().unwrap_or_default()))
        .collect();
    if !errors.is_empty() {
        sections.push(text_section("Couldn't load", errors.join("\n")));
    }
    if sections.is_empty() {
        return Output::done("Codex found no plugins.");
    }
    sections.push(Section {
        text: Some(
            "See one with /plugins <plugin>, add one with /plugins install <plugin>. Both find \
             plugins in Codex's online catalog too."
                .into(),
        ),
        ..Default::default()
    });
    Output::info("Plugins", sections)
}

/// Where `plugin` (`name@marketplace`, or a name only one marketplace has) comes from: its
/// summary, and the fields that name it for `plugin/read` and `plugin/install`. The local
/// marketplaces come first, then what is installed, then a search of the online catalog.
async fn locate_plugin(
    rpc: &mut Session,
    scope: &Value,
    plugin: &str,
) -> Result<(Value, Value), String> {
    let local = local_plugins(rpc, scope).await?;
    if let Some(found) = find_plugin(&local, plugin)? {
        return Ok(found);
    }
    let installed = rpc
        .call("plugin/installed", scope.clone())
        .await
        .map_err(text)?;
    if let Some(found) = find_plugin(&installed, plugin)? {
        return Ok(found);
    }
    // Codex's search matches words, so a hyphenated name is searched as its words.
    let name = plugin.split_once('@').map_or(plugin, |(name, _)| name);
    let mut params = scope.clone();
    params["searchTerm"] = json!(name.replace(['-', '_'], " "));
    params["limit"] = json!(50);
    let found = rpc.call("plugin/search", params).await.map_err(text)?;
    find_plugin(&search_listing(&found), plugin)?
        .ok_or_else(|| format!("Codex has no plugin {plugin}. See /plugins."))
}

/// `plugin/search`'s results in `plugin/list`'s shape: marketplaces with their plugins.
fn search_listing(found: &Value) -> Value {
    let mut marketplaces: Vec<Value> = Vec::new();
    for result in found["data"].as_array().into_iter().flatten() {
        let name = result["marketplaceName"].as_str().unwrap_or_default();
        let at = match marketplaces
            .iter()
            .position(|market| market["name"] == name)
        {
            Some(at) => at,
            None => {
                marketplaces.push(json!({
                    "name": name,
                    "path": result["marketplacePath"],
                    "plugins": [],
                }));
                marketplaces.len() - 1
            }
        };
        if let Some(plugins) = marketplaces[at]["plugins"].as_array_mut() {
            plugins.push(result["plugin"].clone());
        }
    }
    json!({ "marketplaces": marketplaces })
}

/// `plugin` in one listing: None when no marketplace there has it.
fn find_plugin(listing: &Value, plugin: &str) -> Result<Option<(Value, Value)>, String> {
    let (name, market) = match plugin.split_once('@') {
        Some((name, market)) => (name, Some(market)),
        None => (plugin, None),
    };
    let mut found = Vec::new();
    for marketplace in listing["marketplaces"].as_array().into_iter().flatten() {
        let market_name = marketplace["name"].as_str().unwrap_or_default();
        if market.is_some_and(|market| market != market_name) {
            continue;
        }
        for summary in marketplace["plugins"].as_array().into_iter().flatten() {
            if summary["name"].as_str() != Some(name) {
                continue;
            }
            let mut at = json!({ "pluginName": name });
            match marketplace["path"].as_str() {
                Some(path) => at["marketplacePath"] = json!(path),
                None => at["remoteMarketplaceName"] = json!(market_name),
            }
            found.push((summary.clone(), at));
        }
    }
    match found.len() {
        0 => Ok(None),
        1 => Ok(found.pop()),
        _ => Err(format!(
            "More than one marketplace has {plugin}; write it as <plugin>@<marketplace>."
        )),
    }
}

async fn plugin_details(rpc: &mut Session, scope: &Value, plugin: &str) -> Result<Output, String> {
    let (summary, at) = locate_plugin(rpc, scope, plugin).await?;
    let read = rpc.call("plugin/read", at).await.map_err(text)?;
    let detail = &read["plugin"];
    let names = |key: &str, field: &str| -> String {
        detail[key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| match item {
                Value::String(name) => Some(name.clone()),
                other => other[field].as_str().map(str::to_string),
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut rows = vec![
        row(
            "Marketplace",
            detail["marketplaceName"].as_str().unwrap_or_default(),
        ),
        row(
            "Installed",
            if summary["installed"].as_bool() == Some(true) {
                "yes"
            } else {
                "no"
            },
        ),
    ];
    for (label, key, field) in [
        ("Skills", "skills", "name"),
        ("MCP servers", "mcpServers", "name"),
        ("Apps", "apps", "name"),
        ("Hooks", "hooks", "eventName"),
    ] {
        let listed = names(key, field);
        if !listed.is_empty() {
            rows.push(row(label, listed));
        }
    }
    let title = text_at(&summary, "/interface/displayName")
        .or_else(|| text_at(&summary, "/id"))
        .unwrap_or(plugin)
        .to_string();
    Ok(Output::info(
        title,
        vec![Section {
            rows,
            text: text_at(detail, "/description")
                .or_else(|| text_at(&summary, "/interface/longDescription"))
                .map(str::to_string),
            ..Default::default()
        }],
    ))
}

async fn plugin_install(rpc: &mut Session, scope: &Value, plugin: &str) -> Result<Output, String> {
    let (summary, at) = locate_plugin(rpc, scope, plugin).await?;
    let installed = rpc.call("plugin/install", at).await.map_err(text)?;
    let id = summary["id"].as_str().unwrap_or(plugin);
    let needing: Vec<String> = installed["appsNeedingAuth"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|app| {
            let name = text_at(app, "/name")?;
            Some(match text_at(app, "/installUrl") {
                Some(url) => format!("- [{name}]({url})"),
                None => format!("- {name}"),
            })
        })
        .collect();
    if needing.is_empty() {
        return Ok(Output::done(format!("Installed {id}.")));
    }
    Ok(Output::info(
        format!("Installed {id}"),
        vec![text_section(
            "These apps need you to sign in",
            needing.join("\n"),
        )],
    ))
}

async fn plugin_uninstall(
    rpc: &mut Session,
    scope: &Value,
    plugin: &str,
) -> Result<Output, String> {
    // A full id is what Codex removes by; a bare name is looked up among the installed ones.
    let id = if plugin.contains('@') {
        plugin.to_string()
    } else {
        let installed = rpc
            .call("plugin/installed", scope.clone())
            .await
            .map_err(text)?;
        let (summary, _) = find_plugin(&installed, plugin)?
            .ok_or_else(|| format!("No plugin called {plugin} is installed. See /plugins."))?;
        summary["id"].as_str().unwrap_or(plugin).to_string()
    };
    rpc.call("plugin/uninstall", json!({ "pluginId": id }))
        .await
        .map_err(text)?;
    Ok(Output::done(format!("Removed {id}.")))
}
