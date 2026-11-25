use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, Webview};

use crate::app::runtime::MistyRuntime;
use crate::apps::frames;

const SCOPE: &str = "apps:device-permissions";

pub(super) const CAMERA: &str = "camera";
pub(super) const MICROPHONE: &str = "microphone";
pub(super) const LOCATION: &str = "location";

type Answer = Box<dyn FnOnce(bool) + Send>;

struct Pending {
    mount: String,
    key: String,
    kinds: Vec<&'static str>,
    answer: Answer,
}

fn key_of(mount: &str) -> Option<String> {
    let app_id = frames::app_of(mount)?;
    let space = frames::space_of(mount).unwrap_or_default();
    let scope = crate::browser::app_windows::current_scope();
    Some(json!([scope, space, app_id]).to_string())
}

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

fn read_all(app: &AppHandle) -> Map<String, Value> {
    let read = || -> Result<Option<String>, rusqlite::Error> {
        app.state::<MistyRuntime>()
            .environment
            .store()
            .connect()?
            .query_row(
                "SELECT document FROM settings_state WHERE scope = ?1",
                [SCOPE],
                |row| row.get(0),
            )
            .optional()
    };
    read()
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_all(app: &AppHandle, document: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string(document).map_err(|error| error.to_string())?;
    app.state::<MistyRuntime>()
        .environment
        .store()
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO settings_state(scope, revision, document) VALUES(?1, 1, ?2)
                 ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
                params![SCOPE, text],
            )
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn decided(app: &AppHandle, key: &str, kinds: &[&'static str]) -> Option<bool> {
    let all = read_all(app);
    let choices = all.get(key)?.as_object()?;
    let mut allowed = true;
    for kind in kinds {
        match choices.get(*kind).and_then(Value::as_bool) {
            Some(false) => return Some(false),
            Some(true) => {}
            None => allowed = false,
        }
    }
    allowed.then_some(true)
}

fn remember(app: &AppHandle, key: &str, kinds: &[&'static str], allow: bool) {
    let mut all = read_all(app);
    let entry = all
        .entry(key.to_owned())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(choices) = entry.as_object_mut() {
        for kind in kinds {
            choices.insert((*kind).to_owned(), Value::Bool(allow));
        }
    }
    let _ = write_all(app, &all);
}

pub(super) fn ask(app: &AppHandle, mount: &str, kinds: Vec<&'static str>, answer: Answer) {
    let Some(key) = key_of(mount) else {
        return answer(false);
    };
    if let Some(known) = decided(app, &key, &kinds) {
        return answer(known);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let body = json!({ "id": id, "kinds": kinds }).to_string();
    if let Ok(mut waiting) = pending().lock() {
        waiting.insert(
            id,
            Pending {
                mount: mount.to_owned(),
                key,
                kinds,
                answer,
            },
        );
    } else {
        return answer(false);
    }
    frames::emit_page(app, mount, "permission", Some(body));
}

pub(super) fn forget_mount(mount: &str) {
    let gone: Vec<Pending> = pending()
        .lock()
        .map(|mut waiting| {
            let ids: Vec<String> = waiting
                .iter()
                .filter(|(_, entry)| entry.mount == mount)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| waiting.remove(&id))
                .collect()
        })
        .unwrap_or_default();
    for entry in gone {
        (entry.answer)(false);
    }
}

#[tauri::command]
pub fn space_app_page_permission_answer(
    caller: Webview,
    app: AppHandle,
    mount: String,
    id: String,
    allow: bool,
) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    if frames::owner_of(&mount).as_deref() != Some(caller.window().label()) {
        return Err("That app page isn't in this window.".into());
    }
    let entry = pending()
        .lock()
        .map_err(|_| "App permissions are unavailable.")?
        .remove(&id)
        .filter(|entry| entry.mount == mount)
        .ok_or("That question was already answered.")?;
    remember(&app, &entry.key, &entry.kinds, allow);
    (entry.answer)(allow);
    Ok(())
}

#[tauri::command]
pub fn space_apps_forget_permissions(caller: Webview, app: AppHandle) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    write_all(&app, &Map::new())
}

pub(super) fn install(app: &AppHandle, page: &Webview, mount: &str) -> Result<(), String> {
    platform::install(app, page, mount)
}

#[cfg(target_os = "macos")]
mod platform {
    #![allow(unexpected_cfgs)]
    use super::*;
    use objc::runtime::{Class, Object, Sel};
    use objc::{msg_send, sel, sel_impl};

    const DELEGATE_CLASS: &str = "MistyAppPermissionDelegate";
    const GRANT: usize = 1;
    const DENY: usize = 2;

    extern "C" {
        fn _Block_copy(block: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn _Block_release(block: *const std::ffi::c_void);
        fn object_setClass(object: *mut Object, class: *const Class) -> *const Class;
    }

    fn views() -> &'static Mutex<HashMap<usize, String>> {
        static VIEWS: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
        VIEWS.get_or_init(Mutex::default)
    }

    fn mount_for(view: *mut Object) -> Option<String> {
        views().lock().ok()?.get(&(view as usize)).cloned()
    }

    struct Handler(usize);

    impl Handler {
        unsafe fn keep(block: *mut Object) -> Self {
            Self(_Block_copy(block as *const std::ffi::c_void) as usize)
        }
    }

    fn answer_now(handler: Handler, call: fn(usize, bool), allow: bool) {
        call(handler.0, allow);
        unsafe { _Block_release(handler.0 as *const std::ffi::c_void) };
    }

    fn answer_on_main(handler: Handler, call: fn(usize, bool), allow: bool) {
        let Some(app) = frames::app() else {
            return answer_now(handler, call, allow);
        };
        let _ = app.run_on_main_thread(move || {
            call(handler.0, allow);
            unsafe { _Block_release(handler.0 as *const std::ffi::c_void) };
        });
    }

    fn call_media(block: usize, allow: bool) {
        unsafe {
            (&*(block as *const block2::Block<dyn Fn(usize)>)).call((if allow {
                GRANT
            } else {
                DENY
            },))
        };
    }

    fn call_location(block: usize, allow: bool) {
        unsafe {
            (&*(block as *const block2::Block<dyn Fn(objc2::runtime::Bool)>))
                .call((objc2::runtime::Bool::new(allow),))
        };
    }

    extern "C" fn media(
        _delegate: &Object,
        _selector: Sel,
        webview: *mut Object,
        _origin: *mut Object,
        _frame: *mut Object,
        capture: usize,
        handler: *mut Object,
    ) {
        let kinds = match capture {
            0 => vec![CAMERA],
            1 => vec![MICROPHONE],
            _ => vec![CAMERA, MICROPHONE],
        };
        let kept = unsafe { Handler::keep(handler) };
        let (Some(app), Some(mount)) = (frames::app(), mount_for(webview)) else {
            return answer_now(kept, call_media, false);
        };
        ask(
            app,
            &mount,
            kinds,
            Box::new(move |allow| answer_on_main(kept, call_media, allow)),
        );
    }

    extern "C" fn location(
        _delegate: &Object,
        _selector: Sel,
        webview: *mut Object,
        _origin: *mut Object,
        _frame: *mut Object,
        handler: *mut Object,
    ) {
        let kept = unsafe { Handler::keep(handler) };
        let (Some(app), Some(mount)) = (frames::app(), mount_for(webview)) else {
            return answer_now(kept, call_location, false);
        };
        ask(
            app,
            &mount,
            vec![LOCATION],
            Box::new(move |allow| answer_on_main(kept, call_location, allow)),
        );
    }

    extern "C" fn location_for_frame(
        delegate: &Object,
        selector: Sel,
        webview: *mut Object,
        frame: *mut Object,
        handler: *mut Object,
    ) {
        location(
            delegate,
            selector,
            webview,
            std::ptr::null_mut(),
            frame,
            handler,
        );
    }

    pub(super) fn install(_app: &AppHandle, page: &Webview, mount: &str) -> Result<(), String> {
        let mount = mount.to_owned();
        page.with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            if let Ok(mut views) = views().lock() {
                views.retain(|_, other| *other != mount);
                views.insert(view as usize, mount);
            }
            let delegate: *mut Object = msg_send![view, UIDelegate];
            if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS {
                return;
            }
            let subclass = Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
                let mut declaration = objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
                    .expect("unique app permission delegate class");
                declaration.add_method(
                    sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
                    media as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, usize, *mut Object),
                );
                declaration.add_method(
                    sel!(_webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:),
                    location as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut Object),
                );
                declaration.add_method(
                    sel!(_webView:requestGeolocationPermissionForFrame:decisionHandler:),
                    location_for_frame as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object),
                );
                declaration.register()
            });
            object_setClass(delegate, subclass);
            let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<Object>()];
            let _: () = msg_send![view, setUIDelegate: delegate];
        })
        .map_err(|error| error.to_string())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        },
        PermissionRequestedEventHandler,
    };

    struct OnUiThread(
        ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2Deferral,
    );
    unsafe impl Send for OnUiThread {}

    impl OnUiThread {
        fn into_parts(
            self,
        ) -> (
            ICoreWebView2PermissionRequestedEventArgs,
            ICoreWebView2Deferral,
        ) {
            (self.0, self.1)
        }
    }

    pub(super) fn install(app: &AppHandle, page: &Webview, mount: &str) -> Result<(), String> {
        let app = app.clone();
        let mount = mount.to_owned();
        page.with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let kinds = if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    vec![CAMERA]
                } else if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    vec![MICROPHONE]
                } else if kind == COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION {
                    vec![LOCATION]
                } else {
                    return args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                };
                let deferral = args.GetDeferral()?;
                let held = OnUiThread(args, deferral);
                let main = app.clone();
                ask(
                    &app,
                    &mount,
                    kinds,
                    Box::new(move |allow| {
                        let _ = main.run_on_main_thread(move || {
                            let (args, deferral) = held.into_parts();
                            let state = if allow {
                                COREWEBVIEW2_PERMISSION_STATE_ALLOW
                            } else {
                                COREWEBVIEW2_PERMISSION_STATE_DENY
                            };
                            let _ = args.SetState(state);
                            let _ = deferral.Complete();
                        });
                    }),
                );
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
        })
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::*;

    pub(super) fn install(_app: &AppHandle, page: &Webview, _mount: &str) -> Result<(), String> {
        kiri::engine::deny_permission_requests(page)
    }
}
