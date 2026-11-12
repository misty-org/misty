//! The commands that bind a window or the desktop to a task, yield it to the
//! person and mirror the island.
use super::*;

#[tauri::command]
#[cfg_attr(
    not(any(target_os = "macos", windows, target_os = "linux")),
    allow(unreachable_code)
)]
pub fn agent_workspace_context(
    app: AppHandle,
    webview: Webview,
    task_id: String,
    context: Value,
    start: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if !supported() {
        return Err("Misty window control requires macOS 14.4 or later".into());
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    return Err("Misty window control isn't available on this system".into());
    if !crate::browser::app_windows::is_person_window(webview.label())
        || context.to_string().len() > 32000
    {
        return Err("Invalid workspace context".into());
    }
    crate::agents::task_scopes::authorize_window_task(
        &app,
        &task_id,
        context["accountId"].as_str().unwrap_or(""),
        context["spaceId"].as_str().unwrap_or(""),
    )?;
    // The one way into desktop control, on either system. Only a person's window gets here. The
    // lock waits until after asking, since it can take the person a while to answer.
    if start
        && context["desktopControl"] == true
        && !permissions::ensure(&app, permissions::Permission::DesktopControl)
    {
        return Err(
            "Misty needs your OK to control other apps. You can allow it under Settings, Agents, Access."
                .into(),
        );
    }
    let mut state = session().lock().map_err(|_| "workspace_unavailable")?;
    if start {
        let desktop = context["desktopControl"] == true;
        let ask = context["askBeforeControl"] == true;
        *state = Session {
            task: task_id.clone(),
            context,
            snapshot: None,
        };
        drop(state);
        // Controlling the Misty window itself: ring the window. Desktop control
        // rings the controlled display instead, once control begins.
        #[cfg(target_os = "macos")]
        let _ = webview.with_webview(move |platform| {
            crate::agents::cursor::macos::ring_views::window_ring(
                platform.inner().cast(),
                !desktop,
            );
        });
        DESKTOP_APP.get_or_init(|| app.clone());
        #[cfg(windows)]
        if desktop {
            crate::agents::desktop_control::windows::prepare(&app, &task_id, ask);
        }
        #[cfg(target_os = "linux")]
        if desktop {
            crate::agents::desktop_control::linux::control::prepare(&app, &task_id, ask);
        }
        #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
        let _ = (desktop, ask);
        #[cfg(target_os = "macos")]
        if desktop {
            crate::agents::desktop_control::macos::prepare(
                &task_id,
                ask,
                desktop_stopped,
                desktop_island,
            );
        }
    } else {
        if state.task != task_id {
            return Err("agent_task_paused".into());
        }
        if state.context != context {
            state.snapshot = None;
        }
        state.context = context;
    }
    Ok(())
}
/// The task waits for the person (a sign-in, a challenge, a review): give back
/// the window or desktop, its control ring and Misty's cursor, but keep the
/// task so the run continues on the same screen. `yielded: false` takes the
/// window back; the desktop is taken back by the next visual tool call.
#[tauri::command]
pub fn agent_control_yield(webview: Webview, task_id: String, yielded: bool) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Ok(());
    }
    let desktop = {
        let state = session().lock().map_err(|_| "workspace_unavailable")?;
        if state.task != task_id {
            return Ok(());
        }
        state.context["desktopControl"] == true
    };
    #[cfg(target_os = "macos")]
    {
        if desktop {
            if yielded {
                crate::agents::desktop_control::macos::yield_control(&task_id);
            }
        } else if yielded {
            hide_cursor();
        }
        // The mist stays while the task waits for the person, thinner.
        crate::agents::cursor::macos::ring_views::mist_waiting(yielded);
    }
    #[cfg(windows)]
    if let Some(app) = DESKTOP_APP.get() {
        if desktop {
            if yielded {
                crate::agents::desktop_control::windows::yield_control(&task_id);
            }
        } else if yielded {
            crate::agents::desktop_control::windows::overlays::hide_pointer(app);
        }
        crate::agents::desktop_control::windows::overlays::set_mist_waiting(app, yielded);
    }
    #[cfg(target_os = "linux")]
    if desktop && yielded {
        crate::agents::desktop_control::linux::control::yield_control(&task_id);
    } else if !desktop && yielded {
        crate::agents::window_control::linux::release();
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    let _ = (desktop, yielded);
    Ok(())
}
/// What the in-app island shows, mirrored on the desktop island while Misty
/// controls the desktop: `status`, `meta` and, while waiting, `waiting`.
#[tauri::command]
pub fn agent_control_island(
    webview: Webview,
    task_id: String,
    island: Value,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label())
        || island.to_string().len() > 4000
    {
        return Err("Invalid control island update".into());
    }
    {
        let state = session().lock().map_err(|_| "workspace_unavailable")?;
        if state.task != task_id || state.context["desktopControl"] != true {
            return Ok(());
        }
    }
    #[cfg(target_os = "macos")]
    {
        crate::agents::desktop_control::macos::island_text(&task_id, &island.to_string());
    }
    #[cfg(windows)]
    crate::agents::desktop_control::windows::island(&task_id, &island);
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = island;
    Ok(())
}
