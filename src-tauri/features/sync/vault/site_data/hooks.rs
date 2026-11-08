//! What the two sync tasks hear about, and how they start. Every hook here runs on the main thread
//! with Tauri's plugin list locked, so all it does is note the time and pass on a signal.
use super::{cookie_sync, storage_sync};
use crate::browser::app_windows;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{plugin::Plugin, webview::PageLoadPayload, AppHandle, RunEvent, Webview, Window, Wry};
use tokio::sync::{mpsc, oneshot};
use url::Url;

/// A change made when no Misty window has been focused for this long, or nobody has touched this
/// computer for this long, is an idle one.
const IDLE_AFTER_MS: u64 = 5 * 60 * 1000;
/// How long quitting waits for a last look at each store.
const QUIT_FLUSH: Duration = Duration::from_secs(1);
/// How long a page about to load waits for what's held for its site.
const PAGE_WAIT: Duration = Duration::from_secs(1);

/// Something for the sync tasks to act on. Each takes what applies to it.
pub(super) enum Signal {
    /// A profile's window opened.
    Opened(String),
    /// A page finished loading.
    Loaded {
        profile: String,
        origin: Option<String>,
    },
    /// A window is being hidden, left or closed: look now. `None` is every open profile.
    Flush {
        profile: Option<String>,
        done: Option<oneshot::Sender<()>>,
    },
    /// A page of a site with held data is about to load.
    AboutToLoad {
        profile: String,
        origin: String,
        /// The view doing the loading, so it doesn't count as a tab already showing the site.
        loading: Option<String>,
        done: Option<oneshot::Sender<()>>,
    },
}

static FOCUSED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
static LAST_FOCUS_MS: AtomicU64 = AtomicU64::new(0);
static LAST_LOAD_MS: AtomicU64 = AtomicU64::new(0);
static LAST_BACKFILL_MS: AtomicU64 = AtomicU64::new(0);
static SENDERS: OnceLock<Senders> = OnceLock::new();

#[derive(Clone)]
struct Senders {
    cookies: mpsc::UnboundedSender<Signal>,
    storage: mpsc::UnboundedSender<Signal>,
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

pub(super) fn any_focused() -> bool {
    FOCUSED.lock().is_ok_and(|focused| !focused.is_empty())
}

pub(super) fn idle_now() -> bool {
    let left = !any_focused()
        && now_ms().saturating_sub(LAST_FOCUS_MS.load(Ordering::Relaxed)) > IDLE_AFTER_MS;
    left || super::last_input::ms_since_input().is_some_and(|ms| ms > IDLE_AFTER_MS)
}

pub(super) fn recently_loaded(within_ms: u64) -> bool {
    now_ms().saturating_sub(LAST_LOAD_MS.load(Ordering::Relaxed)) < within_ms
}

/// Paces backfill: true at most once per `gap`.
pub(super) fn backfill_due(gap: Duration) -> bool {
    let now = now_ms();
    let last = LAST_BACKFILL_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < gap.as_millis() as u64 {
        return false;
    }
    LAST_BACKFILL_MS.store(now, Ordering::Relaxed);
    true
}

/// Profiles with a window a person browses in. Incognito windows don't make one open.
pub(super) fn open_profiles(app: &AppHandle) -> BTreeSet<String> {
    app_windows::app_windows(app)
        .iter()
        .filter(|window| app_windows::is_person_window(window.label()))
        .filter_map(|window| app_windows::profile_for_window(window.label()))
        .collect()
}

impl Senders {
    fn both(&self, signal: impl Fn() -> Signal) {
        let _ = self.cookies.send(signal());
        let _ = self.storage.send(signal());
    }
}

/// The site a page in a persistent store belongs to. Misty's helper pages and anything in an
/// incognito window have none.
pub(super) fn page_of(webview: &Webview, url: &Url) -> Option<(String, Option<String>)> {
    let label = webview.label();
    if !label.starts_with("misty-browser-")
        || label.starts_with("misty-browser-storage-")
        || label.starts_with("misty-browser-capture-")
    {
        return None;
    }
    let window = webview.window();
    if app_windows::is_incognito_window(window.label()) {
        return None;
    }
    let profile = app_windows::profile_for_owner(window.label())?;
    let origin =
        matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization());
    Some((profile, origin))
}

struct Hooks {
    senders: Senders,
    /// Quitting has been held once already. The next request goes straight through.
    quitting: bool,
}

impl Plugin<Wry> for Hooks {
    fn name(&self) -> &'static str {
        "misty-site-data"
    }

    fn window_created(&mut self, window: Window<Wry>) {
        if !app_windows::is_person_window(window.label()) {
            return;
        }
        if let Some(profile) = app_windows::profile_for_window(window.label()) {
            self.senders.both(|| Signal::Opened(profile.clone()));
        }
    }

    fn on_navigation(&mut self, webview: &Webview<Wry>, url: &Url) -> bool {
        if let Some((profile, Some(origin))) = page_of(webview, url) {
            if storage_sync::is_held(&profile, &origin) {
                let _ = self.senders.storage.send(Signal::AboutToLoad {
                    profile,
                    origin,
                    loading: Some(webview.label().to_owned()),
                    done: None,
                });
            }
        }
        true
    }

    fn on_page_load(&mut self, webview: &Webview<Wry>, payload: &PageLoadPayload<'_>) {
        if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            return;
        }
        if let Some((profile, origin)) = page_of(webview, payload.url()) {
            LAST_LOAD_MS.store(now_ms(), Ordering::Relaxed);
            self.senders.both(|| Signal::Loaded {
                profile: profile.clone(),
                origin: origin.clone(),
            });
        }
    }

    fn on_event(&mut self, app: &AppHandle<Wry>, event: &RunEvent) {
        match event {
            RunEvent::WindowEvent { label, event, .. } => self.window_event(label, event),
            RunEvent::ExitRequested { code, api, .. } => {
                // Misty asks first when quitting would lose unsaved work, and that answer comes
                // back here as a second request: holding this one would ask twice.
                let hold = !self.quitting
                    && crate::browser::app_windows::workspace_recovery::unsaved_count() == 0
                    && !open_profiles(app).is_empty();
                self.quitting = true;
                if !hold {
                    return;
                }
                api.prevent_exit();
                let (app, senders, code) = (app.clone(), self.senders.clone(), code.unwrap_or(0));
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(QUIT_FLUSH, flush(&senders)).await;
                    app.exit(code);
                });
            }
            _ => {}
        }
    }
}

impl Hooks {
    fn window_event(&self, label: &str, event: &tauri::WindowEvent) {
        match event {
            tauri::WindowEvent::Focused(focused) => {
                LAST_FOCUS_MS.store(now_ms(), Ordering::Relaxed);
                if let Ok(mut windows) = FOCUSED.lock() {
                    if *focused {
                        windows.insert(label.to_owned());
                    } else {
                        windows.remove(label);
                    }
                }
                // Losing focus also covers a window being hidden, which Tauri doesn't report.
                // Cookies also hear about gaining it, since that changes how often they look.
                let flush = || Signal::Flush {
                    profile: None,
                    done: None,
                };
                let _ = self.senders.cookies.send(flush());
                if !*focused {
                    let _ = self.senders.storage.send(flush());
                }
            }
            tauri::WindowEvent::CloseRequested { .. } => {
                if let Some(profile) = app_windows::profile_for_window(label)
                    .filter(|_| app_windows::is_person_window(label))
                {
                    self.senders.both(|| Signal::Flush {
                        profile: Some(profile.clone()),
                        done: None,
                    });
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Ok(mut windows) = FOCUSED.lock() {
                    windows.remove(label);
                }
            }
            _ => {}
        }
    }
}

async fn flush(senders: &Senders) {
    let (cookies_done, cookies) = oneshot::channel();
    let (storage_done, storage) = oneshot::channel();
    let _ = senders.cookies.send(Signal::Flush {
        profile: None,
        done: Some(cookies_done),
    });
    let _ = senders.storage.send(Signal::Flush {
        profile: None,
        done: Some(storage_done),
    });
    let _ = tokio::join!(cookies, storage);
}

/// Starts following every open profile's website data, for the life of the app. Account changes
/// are picked up by the tasks themselves.
pub(crate) fn start(app: &AppHandle) {
    let (cookies, cookie_signals) = mpsc::unbounded_channel();
    let (storage, storage_signals) = mpsc::unbounded_channel();
    let senders = Senders { cookies, storage };
    let _ = SENDERS.set(senders.clone());
    tauri::async_runtime::spawn(cookie_sync::run(app.clone(), cookie_signals));
    tauri::async_runtime::spawn(storage_sync::run(app.clone(), storage_signals));
    let hooks = Hooks {
        senders,
        quitting: false,
    };
    if app.plugin(hooks).is_err() && cfg!(debug_assertions) {
        eprintln!("[site-data] could not follow pages and windows");
    }
}

/// See `site_data::prepare_page`.
pub(super) async fn prepare_page(profile: &str, url: &str, loading: Option<String>) {
    let (Some(senders), Ok(url)) = (SENDERS.get(), Url::parse(url)) else {
        return;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let origin = url.origin().ascii_serialization();
    let (cookies_done, cookies) = oneshot::channel();
    let _ = senders.cookies.send(Signal::AboutToLoad {
        profile: profile.to_owned(),
        origin: origin.clone(),
        loading: None,
        done: Some(cookies_done),
    });
    let storage = if storage_sync::is_held(profile, &origin) {
        let (storage_done, storage) = oneshot::channel();
        let _ = senders.storage.send(Signal::AboutToLoad {
            profile: profile.to_owned(),
            origin,
            loading,
            done: Some(storage_done),
        });
        Some(storage)
    } else {
        None
    };
    let _ = tokio::time::timeout(PAGE_WAIT, async {
        let _ = cookies.await;
        if let Some(storage) = storage {
            let _ = storage.await;
        }
    })
    .await;
}
