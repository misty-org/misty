use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{Manager, Runtime, Webview, Window};
use webview2_com::FocusChangedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC;

const SETTLE: Duration = Duration::from_millis(60);

fn last_focused() -> &'static Mutex<HashMap<String, String>> {
    static LAST: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    LAST.get_or_init(Mutex::default)
}

fn lost_to_app() -> &'static Mutex<HashSet<String>> {
    static LOST: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LOST.get_or_init(Mutex::default)
}

fn had_focus() -> &'static Mutex<HashSet<String>> {
    static HAD: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    HAD.get_or_init(Mutex::default)
}

fn programmatic() -> &'static Mutex<HashSet<String>> {
    static PROGRAMMATIC: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PROGRAMMATIC.get_or_init(Mutex::default)
}

pub(crate) fn take_programmatic(label: &str) -> bool {
    programmatic()
        .lock()
        .is_ok_and(|mut marked| marked.remove(label))
}

pub(crate) fn watch<R: Runtime>(webview: &Webview<R>) {
    let app = webview.app_handle().clone();
    let label = webview.label().to_owned();
    let _ = webview.with_webview(move |platform| {
        let lost_label = label.clone();
        let lost = FocusChangedEventHandler::create(Box::new(move |_, _| {
            if let Ok(mut marked) = programmatic().lock() {
                marked.remove(&lost_label);
            }
            let had = had_focus()
                .lock()
                .is_ok_and(|mut had| had.remove(&lost_label));
            if had {
                if let Ok(mut lost) = lost_to_app().lock() {
                    lost.insert(lost_label.clone());
                }
            }
            Ok(())
        }));
        let mut lost_token = Default::default();
        // SAFETY: the controller is live during this UI-thread callback.
        let _ = unsafe { platform.controller().add_LostFocus(&lost, &mut lost_token) };
        let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
            if let Ok(mut lost) = lost_to_app().lock() {
                lost.remove(&label);
            }
            if label.starts_with("misty-browser-") {
                if let Ok(mut had) = had_focus().lock() {
                    had.insert(label.clone());
                }
            }
            if let Some(view) = app.get_webview(&label) {
                if let Ok(mut last) = last_focused().lock() {
                    last.insert(view.window().label().to_owned(), label.clone());
                }
            }
            Ok(())
        }));
        let mut token = Default::default();
        // SAFETY: the controller is live during this UI-thread callback.
        let _ = unsafe { platform.controller().add_GotFocus(&handler, &mut token) };
    });
}

fn is_active<R: Runtime>(window: &Window<R>) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    // SAFETY: plain query with no arguments.
    unsafe { GetForegroundWindow() as isize == hwnd.0 as isize }
}

pub(crate) fn restore_page<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let label = webview.label().to_owned();
    let lost = lost_to_app().lock().is_ok_and(|lost| lost.contains(&label));
    if !lost || !is_active(&webview.window()) {
        return Ok(());
    }
    if let Ok(mut marked) = programmatic().lock() {
        marked.insert(label.clone());
    }
    webview
        .with_webview(move |platform| {
            let controller = platform.controller();
            let mut visible = Default::default();
            // SAFETY: the controller is live during this UI-thread callback.
            let shown = unsafe { controller.IsVisible(&mut visible) }.is_ok() && visible.as_bool();
            if !shown {
                if let Ok(mut marked) = programmatic().lock() {
                    marked.remove(&label);
                }
                return;
            }
            if unsafe { controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) }.is_err()
            {
                if let Ok(mut marked) = programmatic().lock() {
                    marked.remove(&label);
                }
            }
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn forget(window: &str) {
    if let Ok(mut last) = last_focused().lock() {
        last.remove(window);
    }
}

fn target(window: &str, remembered: Option<&str>, lives_here: impl Fn(&str) -> bool) -> String {
    remembered
        .filter(|label| lives_here(label))
        .unwrap_or(window)
        .to_owned()
}

pub(crate) fn window_activated(window: &Window) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };
    let pressed = [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
        .into_iter()
        .any(|button| unsafe { GetAsyncKeyState(i32::from(button)) } < 0);
    if pressed {
        return;
    }
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        let app = window.app_handle().clone();
        let _ = app.run_on_main_thread(move || restore(&window));
    });
}

fn restore(window: &Window) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetFocus;
    let Ok(hwnd) = window.hwnd() else { return };
    let focused = unsafe { GetFocus() };
    if !focused.is_null() && focused as isize != hwnd.0 as isize {
        return;
    }
    if !is_active(window) {
        return;
    }
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    let remembered = last_focused()
        .lock()
        .ok()
        .and_then(|last| last.get(&label).cloned());
    let lives_here = |view: &str| {
        app.get_webview(view)
            .is_some_and(|view| view.window().label() == label)
    };
    let chosen = target(&label, remembered.as_deref(), lives_here);
    let fallback = label.clone();
    let Some(view) = app.get_webview(&chosen) else {
        return;
    };
    let app_for_fallback = app.clone();
    let _ = view.with_webview(move |platform| {
        let controller = platform.controller();
        let mut visible = Default::default();
        // SAFETY: the controller is live during this UI-thread callback.
        let shown = unsafe { controller.IsVisible(&mut visible) }.is_ok() && visible.as_bool();
        if shown {
            let _ = unsafe { controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) };
        } else if chosen != fallback {
            if let Some(app_view) = app_for_fallback.get_webview(&fallback) {
                let _ = app_view.set_focus();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::target;

    #[test]
    fn returns_to_the_webview_focused_last_while_it_is_in_the_window() {
        let here = |label: &str| label == "misty-browser-tab-1";
        assert_eq!(
            target("space-1", Some("misty-browser-tab-1"), here),
            "misty-browser-tab-1"
        );
    }

    #[test]
    fn falls_back_to_the_app_view() {
        assert_eq!(
            target("space-1", Some("misty-browser-tab-1"), |_| false),
            "space-1"
        );
        assert_eq!(target("space-1", None, |_| true), "space-1");
    }
}
