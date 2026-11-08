//! The location source for WebKit on macOS. `WKWebView` has none of its own: after a grant,
//! `getCurrentPosition` waits until its timeout unless the app supplies positions through
//! WebKit's geolocation provider. This reads them from Core Location, which asks once for the
//! app, and only runs while a granted page is listening.
#![allow(unexpected_cfgs)]

use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::{
    cell::RefCell,
    collections::HashSet,
    ffi::{c_char, c_int, c_void, CString},
    sync::OnceLock,
};

#[link(name = "CoreLocation", kind = "framework")]
extern "C" {}

extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

const DELEGATE_CLASS: &str = "KiriLocationDelegate";
const RTLD_NOW: c_int = 2;

/// CLAuthorizationStatus.
const NOT_DETERMINED: i32 = 0;
const RESTRICTED: i32 = 1;
const DENIED: i32 = 2;

type Ref = *const c_void;
type Callback = extern "C" fn(Ref, Ref);

/// WKGeolocationProviderV0.
#[repr(C)]
struct Provider {
    version: c_int,
    client: Ref,
    start: Callback,
    stop: Callback,
}

// Holds only function pointers and a null client.
unsafe impl Sync for Provider {}

static PROVIDER: Provider = Provider {
    version: 0,
    client: std::ptr::null(),
    start: start_updating,
    stop: stop_updating,
};

/// WebKit's geolocation C API. It is not in the SDK's stubs, so it is looked up at run time; if a
/// later macOS drops it, location fails as it did without a provider, and nothing else does.
struct Api {
    page_context: unsafe extern "C" fn(Ref) -> Ref,
    context_manager: unsafe extern "C" fn(Ref) -> Ref,
    set_provider: unsafe extern "C" fn(Ref, *const Provider),
    position_changed: unsafe extern "C" fn(Ref, Ref),
    position_failed: unsafe extern "C" fn(Ref),
    create_position: unsafe extern "C" fn(f64, f64, f64, f64) -> Ref,
    release: unsafe extern "C" fn(Ref),
}

// Function pointers only.
unsafe impl Send for Api {}
unsafe impl Sync for Api {}

fn api() -> Option<&'static Api> {
    static API: OnceLock<Option<Api>> = OnceLock::new();
    API.get_or_init(|| unsafe {
        let path = CString::new("/System/Library/Frameworks/WebKit.framework/WebKit").ok()?;
        let handle = dlopen(path.as_ptr(), RTLD_NOW);
        if handle.is_null() {
            return None;
        }
        let symbol = |name: &str| -> Option<*mut c_void> {
            let name = CString::new(name).ok()?;
            let found = dlsym(handle, name.as_ptr());
            (!found.is_null()).then_some(found)
        };
        Some(Api {
            page_context: std::mem::transmute(symbol("WKPageGetContext")?),
            context_manager: std::mem::transmute(symbol("WKContextGetGeolocationManager")?),
            set_provider: std::mem::transmute(symbol("WKGeolocationManagerSetProvider")?),
            position_changed: std::mem::transmute(symbol(
                "WKGeolocationManagerProviderDidChangePosition",
            )?),
            position_failed: std::mem::transmute(symbol(
                "WKGeolocationManagerProviderDidFailToDeterminePosition",
            )?),
            create_position: std::mem::transmute(symbol("WKGeolocationPositionCreate")?),
            release: std::mem::transmute(symbol("WKRelease")?),
        })
    })
    .as_ref()
}

/// Everything here runs on the main thread: WebKit and Core Location both call back on it.
#[derive(Default)]
struct State {
    /// Managers with a provider, one per WebKit process pool.
    attached: HashSet<usize>,
    /// Managers with a page listening.
    listening: HashSet<usize>,
    /// The CLLocationManager, retained for as long as the app runs.
    manager: Option<usize>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}

/// Gives the view's process pool a location source. Safe to call again for the same pool.
pub(super) unsafe fn attach(view: *mut Object) {
    let Some(api) = api() else {
        return;
    };
    let selector = sel!(_pageRefForTransitionToWKWebView);
    let responds: bool = msg_send![view, respondsToSelector: selector];
    if !responds {
        return;
    }
    let page: Ref = msg_send![view, _pageRefForTransitionToWKWebView];
    if page.is_null() {
        return;
    }
    let context = (api.page_context)(page);
    let manager = (api.context_manager)(context);
    if manager.is_null() {
        return;
    }
    let new = STATE.with(|state| state.borrow_mut().attached.insert(manager as usize));
    if new {
        (api.set_provider)(manager, &PROVIDER);
    }
}

fn delegate_class() -> &'static Class {
    Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
        let mut declaration = objc::declare::ClassDecl::new(DELEGATE_CLASS, class!(NSObject))
            .expect("unique location delegate class");
        unsafe {
            declaration.add_method(
                sel!(locationManager:didUpdateLocations:),
                did_update as extern "C" fn(&Object, Sel, *mut Object, *mut Object),
            );
            declaration.add_method(
                sel!(locationManager:didFailWithError:),
                did_fail as extern "C" fn(&Object, Sel, *mut Object, *mut Object),
            );
            declaration.add_method(
                sel!(locationManagerDidChangeAuthorization:),
                did_change_authorization as extern "C" fn(&Object, Sel, *mut Object),
            );
        }
        declaration.register()
    })
}

unsafe fn location_manager() -> *mut Object {
    if let Some(existing) = STATE.with(|state| state.borrow().manager) {
        return existing as *mut Object;
    }
    let manager: *mut Object = msg_send![class!(CLLocationManager), new];
    let delegate: *mut Object = msg_send![delegate_class(), new];
    let _: () = msg_send![manager, setDelegate: delegate];
    STATE.with(|state| state.borrow_mut().manager = Some(manager as usize));
    manager
}

unsafe fn authorization(manager: *mut Object) -> i32 {
    msg_send![manager, authorizationStatus]
}

/// Whether macOS has refused this app location, so a site's grant can't reach anything.
pub(super) fn blocked_by_system() -> bool {
    unsafe {
        let enabled: bool = msg_send![class!(CLLocationManager), locationServicesEnabled];
        !enabled || matches!(authorization(location_manager()), RESTRICTED | DENIED)
    }
}

fn notify_failed() {
    let Some(api) = api() else {
        return;
    };
    STATE.with(|state| {
        for manager in &state.borrow().listening {
            unsafe { (api.position_failed)(*manager as Ref) };
        }
    });
}

/// Starts reading once macOS allows it; the first time, this is what makes macOS ask.
unsafe fn begin(manager: *mut Object) {
    match authorization(manager) {
        NOT_DETERMINED => {
            let _: () = msg_send![manager, requestWhenInUseAuthorization];
        }
        RESTRICTED | DENIED => notify_failed(),
        _ => {
            let _: () = msg_send![manager, startUpdatingLocation];
        }
    }
}

extern "C" fn start_updating(manager: Ref, _client: Ref) {
    STATE.with(|state| state.borrow_mut().listening.insert(manager as usize));
    unsafe { begin(location_manager()) };
}

extern "C" fn stop_updating(manager: Ref, _client: Ref) {
    let idle = STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.listening.remove(&(manager as usize));
        state.listening.is_empty()
    });
    if idle {
        unsafe {
            let _: () = msg_send![location_manager(), stopUpdatingLocation];
        }
    }
}

/// CLLocationCoordinate2D.
#[repr(C)]
#[derive(Clone, Copy)]
struct Coordinate {
    latitude: f64,
    longitude: f64,
}

extern "C" fn did_update(_: &Object, _: Sel, _manager: *mut Object, locations: *mut Object) {
    let Some(api) = api() else {
        return;
    };
    unsafe {
        let location: *mut Object = msg_send![locations, lastObject];
        if location.is_null() {
            return;
        }
        let coordinate: Coordinate = msg_send![location, coordinate];
        let accuracy: f64 = msg_send![location, horizontalAccuracy];
        // A negative accuracy is Core Location's way of saying the coordinates mean nothing.
        if accuracy < 0.0 {
            return;
        }
        let date: *mut Object = msg_send![location, timestamp];
        let timestamp: f64 = msg_send![date, timeIntervalSince1970];
        let position = (api.create_position)(
            timestamp,
            coordinate.latitude,
            coordinate.longitude,
            accuracy,
        );
        STATE.with(|state| {
            for manager in &state.borrow().listening {
                (api.position_changed)(*manager as Ref, position);
            }
        });
        (api.release)(position);
    }
}

extern "C" fn did_fail(_: &Object, _: Sel, _manager: *mut Object, error: *mut Object) {
    // kCLErrorLocationUnknown is temporary: Core Location keeps trying, so the page keeps waiting.
    let code: isize = unsafe { msg_send![error, code] };
    if code != 0 {
        notify_failed();
    }
}

extern "C" fn did_change_authorization(_: &Object, _: Sel, manager: *mut Object) {
    let listening = STATE.with(|state| !state.borrow().listening.is_empty());
    if listening {
        unsafe {
            if authorization(manager) != NOT_DETERMINED {
                begin(manager);
            }
        }
    }
}
