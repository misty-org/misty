//! The dock check through the eval bridge (debug builds only): detach a tab
//! into a docked window, stack, fan out, open and bring back, and read what
//! the page and macOS report (docs/design/agents-at-cursor/BRIEF.md).
use super::*;

/// The dock check (docs/design/agents-at-cursor/BRIEF.md): detach a tab into a
/// docked window, stack, fan out, open and bring back, and read visibility.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Dock {
    action: String,
    #[serde(default)]
    scope_id: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    name: String,
}

pub(super) async fn dock(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Dock>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let app = &bridge.app;
    let result = match body.action.as_str() {
        "detach" => {
            let id = match bridge.tabs.lock().await.get(&body.scope_id) {
                Some(tab) => tab.id.clone(),
                None => return reply(Err("The benchmark tab is not open.".into())),
            };
            match crate::infra::space_windows::primary(app) {
                Some(window) => {
                    crate::infra::agent_dock::detach(app, &window, &id, &body.name, "Dock check")
                        .map(|host| json!({ "host": host }))
                }
                None => Err("Misty's main window is not open.".into()),
            }
        }
        "attach" => crate::infra::agent_dock::attach(app, &body.host).map(|_| json!({})),
        "open" => crate::infra::agent_dock::open(app, &body.host).map(|_| json!({})),
        "dock" => crate::infra::agent_dock::dock(app, &body.host, &body.name).map(|_| json!({})),
        "carousel" => crate::infra::agent_dock::carousel(app, true).map(|_| json!({})),
        "fold" => crate::infra::agent_dock::carousel(app, false).map(|_| json!({})),
        "visibility" => crate::infra::agent_dock::visibility_now(app).await,
        "hide_app" | "unhide_app" | "minimize" | "unminimize" => {
            let action = body.action.trim_end_matches("_app").to_owned();
            crate::infra::agent_dock::test_app(app, &action).map(|_| json!({}))
        }
        // Ends the tab's task but keeps the tab, so another tab can hold one.
        "release" => match bridge.tabs.lock().await.get(&body.scope_id) {
            Some(tab) => {
                tab.renew.abort();
                main_view(app).and_then(|view| {
                    agent_workspace::agent_workspace_release(
                        view,
                        app.state::<AgentWorkspaceState>(),
                        tab.task.clone(),
                    )
                    .map(|_| json!({}))
                })
            }
            None => Err("The benchmark tab is not open.".into()),
        },
        // The page as the agent would see it, without a task.
        #[cfg(target_os = "macos")]
        "snapshot" => {
            let id = bridge
                .tabs
                .lock()
                .await
                .get(&body.scope_id)
                .map(|tab| tab.id.clone());
            match id
                .and_then(|id| webview_label(&id).ok())
                .and_then(|l| app.get_webview(&l))
            {
                Some(view) => match view.size().map_err(|e| e.to_string()).and_then(|size| {
                    let scale = view.window().scale_factor().map_err(|e| e.to_string())?;
                    Ok(size.to_logical::<f64>(scale))
                }) {
                    Ok(size) => {
                        crate::infra::browser_macos::capture_webview_region_sized(
                            view,
                            0.0,
                            0.0,
                            size.width,
                            size.height,
                            2560.0,
                        )
                        .await
                    }
                    Err(error) => Err(error),
                },
                None => Err("The benchmark tab is not running.".into()),
            }
        }
        _ => Err("Unknown dock action.".into()),
    };
    reply(result)
}
