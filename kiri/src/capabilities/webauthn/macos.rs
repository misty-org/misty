//! macOS: AuthenticationServices' web-browser passkey APIs, which accept the
//! caller's origin from the browser. They need the restricted
//! `com.apple.developer.web-browser.public-key-credential` entitlement; without
//! it Kiri leaves WebKit's own WebAuthn in place.
#![allow(unexpected_cfgs)]

use super::{Assertion, Authenticator, Ceremony, CreateRequest, GetRequest, Registration};
use crate::{Host, KiriError};
use objc::runtime::{Class, Object};
use objc::{msg_send, sel, sel_impl};
use std::{
    ffi::{c_void, CString},
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::oneshot;

#[path = "macos_delegate.rs"]
mod delegate;
#[path = "macos_requests.rs"]
mod requests;
use delegate::{pending, Outcome, Pending};
use requests::{assertion_requests, registration_requests};

pub(super) type Id = *mut Object;


#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecTaskCreateFromSelf(allocator: *const c_void) -> *const c_void;
    fn SecTaskCopyValueForEntitlement(
        task: *const c_void,
        entitlement: *const c_void,
        error: *mut *const c_void,
    ) -> *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: *const c_void);
    fn CFGetTypeID(value: *const c_void) -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: *const c_void) -> u8;
}

const ENTITLEMENT: &str = "com.apple.developer.web-browser.public-key-credential";

/// Whether this build may run passkey ceremonies for any site.
pub fn available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| unsafe { supported_system() && entitled() })
}

unsafe fn supported_system() -> bool {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    (version.majorVersion, version.minorVersion) >= (13, 5)
}

unsafe fn entitled() -> bool {
    let task = SecTaskCreateFromSelf(std::ptr::null());
    if task.is_null() {
        return false;
    }
    let value = SecTaskCopyValueForEntitlement(task, string(ENTITLEMENT) as *const c_void, std::ptr::null_mut());
    CFRelease(task);
    if value.is_null() {
        return false;
    }
    let granted = CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value) != 0;
    CFRelease(value);
    granted
}

pub(super) fn class(name: &str) -> Result<&'static Class, KiriError> {
    Class::get(name).ok_or_else(|| KiriError::not_supported("Passkeys are not available on this Mac."))
}

pub(super) unsafe fn string(text: &str) -> Id {
    let text = CString::new(text.replace('\0', "")).unwrap_or_default();
    msg_send![Class::get("NSString").expect("NSString"), stringWithUTF8String: text.as_ptr()]
}

pub(super) unsafe fn data(bytes: &[u8]) -> Id {
    msg_send![Class::get("NSData").expect("NSData"), dataWithBytes: bytes.as_ptr() as *const c_void length: bytes.len()]
}

pub(super) unsafe fn array(items: &[Id]) -> Id {
    msg_send![Class::get("NSArray").expect("NSArray"), arrayWithObjects: items.as_ptr() as *const c_void count: items.len()]
}

pub(super) unsafe fn responds(object: Id, selector: objc::runtime::Sel) -> bool {
    let answer: objc::runtime::BOOL = msg_send![object, respondsToSelector: selector];
    answer == objc::runtime::YES
}

/// `[[Class alloc] init…]`, handed to the autorelease pool.
pub(super) unsafe fn made(object: Id) -> Id {
    msg_send![object, autorelease]
}


enum Ask {
    Create(CreateRequest),
    Get(GetRequest),
}

type Reply = oneshot::Sender<Result<Outcome, KiriError>>;

/// Runs on the main thread once Misty's access to passkeys is settled.
unsafe fn perform(ask: Ask, platform: bool, reply: Reply) {
    let requests = match &ask {
        Ask::Create(request) => registration_requests(request, platform),
        Ask::Get(request) => assertion_requests(request, platform),
    };
    let requests = match requests {
        Ok(requests) if !requests.is_empty() => requests,
        Ok(_) => {
            let _ = reply.send(Err(KiriError::not_allowed(
                "Misty is not allowed to use passkeys. Allow it in System Settings.",
            )));
            return;
        }
        Err(error) => {
            let _ = reply.send(Err(error));
            return;
        }
    };
    let started = (|| -> Result<(Id, Id), KiriError> {
        let allocated: Id = msg_send![class("ASAuthorizationController")?, alloc];
        let controller: Id = msg_send![allocated, initWithAuthorizationRequests: array(&requests)];
        let delegate: Id = msg_send![delegate::class()?, new];
        let _: () = msg_send![controller, setDelegate: delegate];
        let _: () = msg_send![controller, setPresentationContextProvider: delegate];
        Ok((controller, delegate))
    })();
    match started {
        Ok((controller, delegate)) => {
            if let Ok(mut slot) = pending().lock() {
                *slot = Some(Pending {
                    controller: controller as usize,
                    delegate: delegate as usize,
                    reply,
                });
            }
            let _: () = msg_send![controller, performRequests];
        }
        Err(error) => {
            let _ = reply.send(Err(error));
        }
    }
}

/// Settles whether Misty may use the person's passkeys, asking the first time.
/// A request waiting on the person's answer to "use passkeys in Misty?".
/// Cancel can end it before the system answers.
type Authorizing = (Ask, Reply, Arc<dyn Host>);

fn authorizing() -> &'static Mutex<Option<Authorizing>> {
    static AUTHORIZING: OnceLock<Mutex<Option<Authorizing>>> = OnceLock::new();
    AUTHORIZING.get_or_init(Mutex::default)
}

unsafe fn begin(host: Arc<dyn Host>, ask: Ask, reply: Reply) {
    let busy = pending().lock().map_or(true, |slot| slot.is_some())
        || authorizing().lock().map_or(true, |slot| slot.is_some());
    if busy {
        let _ = reply.send(Err(KiriError::not_allowed("A passkey request is already open.")));
        return;
    }
    let Some(manager_class) = Class::get("ASAuthorizationWebBrowserPublicKeyCredentialManager") else {
        perform(ask, false, reply);
        return;
    };
    let manager: Id = msg_send![manager_class, new];
    // Authorized = 0, Denied = 1, NotDetermined = 2.
    let state: isize = msg_send![manager, authorizationStateForPlatformCredentials];
    if state != 2 {
        let _: () = msg_send![manager, release];
        perform(ask, state == 0, reply);
        return;
    }
    if let Ok(mut slot) = authorizing().lock() {
        *slot = Some((ask, reply, host.clone()));
    }
    let manager_address = manager as usize;
    let answered: block2::RcBlock<dyn Fn(isize)> = block2::RcBlock::new(move |state: isize| {
        host.run_on_main(Box::new(move || unsafe {
            let _: () = msg_send![manager_address as Id, release];
            // Gone if the page canceled while the system was asking.
            if let Some((ask, reply, _)) = authorizing().lock().ok().and_then(|mut slot| slot.take()) {
                perform(ask, state == 0, reply);
            }
        }));
    });
    let _: () = msg_send![manager,
        requestAuthorizationForPublicKeyCredentials: &*answered as *const block2::Block<dyn Fn(isize)> as *const c_void];
}

fn start(host: Arc<dyn Host>, ask: Ask) -> impl std::future::Future<Output = Result<Outcome, KiriError>> + Send {
    let (send, receive) = oneshot::channel();
    let main = host.clone();
    host.run_on_main(Box::new(move || unsafe { begin(main, ask, send) }));
    async move {
        receive
            .await
            .map_err(|_| KiriError::not_allowed("The passkey request ended."))?
    }
}

/// Runs ceremonies through AuthenticationServices. Kiri registers it only when
/// `available()`; embedders may construct it directly to exercise the path.
pub struct MacAuthenticator;

impl Authenticator for MacAuthenticator {
    fn create(&self, request: CreateRequest, host: Arc<dyn Host>) -> Ceremony<Registration> {
        let outcome = start(host, Ask::Create(request));
        Box::pin(async move {
            match outcome.await? {
                Outcome::Registration(registration) => Ok(registration),
                Outcome::Assertion(_) => Err(KiriError::not_allowed("The authenticator answered a different request.")),
            }
        })
    }

    fn get(&self, request: GetRequest, host: Arc<dyn Host>) -> Ceremony<Assertion> {
        let outcome = start(host, Ask::Get(request));
        Box::pin(async move {
            match outcome.await? {
                Outcome::Assertion(assertion) => Ok(assertion),
                Outcome::Registration(_) => Err(KiriError::not_allowed("The authenticator answered a different request.")),
            }
        })
    }

    fn cancel(&self, host: Arc<dyn Host>) {
        host.run_on_main(Box::new(|| unsafe {
            // Still waiting on the system's passkey access question: settle the
            // page's request now; the late answer finds nothing to run.
            if let Some((_, reply, _)) = authorizing().lock().ok().and_then(|mut slot| slot.take()) {
                let _ = reply.send(Err(KiriError::not_allowed("The request was canceled.")));
                return;
            }
            let controller = pending().lock().ok().and_then(|slot| slot.as_ref().map(|pending| pending.controller));
            if let Some(controller) = controller {
                let _: () = msg_send![controller as Id, cancel];
            }
        }));
    }
}
