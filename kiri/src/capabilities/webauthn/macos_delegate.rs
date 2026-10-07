//! The ASAuthorizationController delegate: reads the credential the system
//! returns and anchors the system sheet to Misty's window.

use super::{responds, Id};
use crate::capabilities::webauthn::{Assertion, Attachment, Registration};
use crate::KiriError;
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Protocol, Sel};
use objc::{msg_send, sel, sel_impl};
use std::{
    ffi::CStr,
    os::raw::c_char,
    sync::{Mutex, OnceLock},
};
use tokio::sync::oneshot;

const DELEGATE_CLASS: &str = "KiriAuthorizationDelegate";

pub(super) enum Outcome {
    Registration(Registration),
    Assertion(Assertion),
}

/// The one ceremony in flight. Touched only on the main thread.
pub(super) struct Pending {
    pub controller: usize,
    pub delegate: usize,
    pub reply: oneshot::Sender<Result<Outcome, KiriError>>,
}

pub(super) fn pending() -> &'static Mutex<Option<Pending>> {
    static PENDING: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

pub(super) fn class() -> Result<&'static Class, KiriError> {
    if let Some(class) = Class::get(DELEGATE_CLASS) {
        return Ok(class);
    }
    let unavailable = || KiriError::not_supported("Passkeys are not available on this Mac.");
    let superclass = Class::get("NSObject").ok_or_else(unavailable)?;
    let mut declaration = ClassDecl::new(DELEGATE_CLASS, superclass).ok_or_else(unavailable)?;
    unsafe {
        declaration.add_method(
            sel!(authorizationController:didCompleteWithAuthorization:),
            completed as extern "C" fn(&Object, Sel, Id, Id),
        );
        declaration.add_method(
            sel!(authorizationController:didCompleteWithError:),
            failed as extern "C" fn(&Object, Sel, Id, Id),
        );
        declaration.add_method(
            sel!(presentationAnchorForAuthorizationController:),
            anchor as extern "C" fn(&Object, Sel, Id) -> Id,
        );
    }
    for name in ["ASAuthorizationControllerDelegate", "ASAuthorizationControllerPresentationContextProviding"] {
        if let Some(protocol) = Protocol::get(name) {
            declaration.add_protocol(protocol);
        }
    }
    Ok(declaration.register())
}

/// Ends the ceremony. The controller is mid-callback, so it and the delegate
/// are released through the autorelease pool rather than immediately.
unsafe fn finish(result: Result<Outcome, KiriError>) {
    let Some(pending) = pending().lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    let _: Id = msg_send![pending.controller as Id, autorelease];
    let _: Id = msg_send![pending.delegate as Id, autorelease];
    let _ = pending.reply.send(result);
}

unsafe fn bytes(data: Id) -> Vec<u8> {
    if data.is_null() {
        return Vec::new();
    }
    let length: usize = msg_send![data, length];
    let pointer: *const u8 = msg_send![data, bytes];
    if pointer.is_null() || length == 0 {
        return Vec::new();
    }
    std::slice::from_raw_parts(pointer, length).to_vec()
}

unsafe fn strings(list: Id) -> Vec<String> {
    if list.is_null() {
        return Vec::new();
    }
    let count: usize = msg_send![list, count];
    (0..count)
        .filter_map(|index| {
            let item: Id = msg_send![list, objectAtIndex: index];
            let text: *const c_char = msg_send![item, UTF8String];
            (!text.is_null()).then(|| CStr::from_ptr(text).to_string_lossy().into_owned())
        })
        .collect()
}

unsafe fn read(credential: Id) -> Result<Outcome, KiriError> {
    if credential.is_null() {
        return Err(KiriError::not_allowed("The authenticator returned no credential."));
    }
    let security_key = (*credential).class().name().contains("SecurityKey");
    let attachment = if responds(credential, sel!(attachment)) {
        let value: isize = msg_send![credential, attachment];
        if value == 0 {
            Attachment::Platform
        } else {
            Attachment::CrossPlatform
        }
    } else if security_key {
        Attachment::CrossPlatform
    } else {
        Attachment::Platform
    };
    let credential_id: Id = msg_send![credential, credentialID];
    let client_data: Id = msg_send![credential, rawClientDataJSON];
    if responds(credential, sel!(rawAttestationObject)) {
        let attestation: Id = msg_send![credential, rawAttestationObject];
        let transports = if !security_key {
            // Synced passkeys can also be used from a phone.
            vec!["hybrid".to_owned(), "internal".to_owned()]
        } else if responds(credential, sel!(transports)) {
            let list: Id = msg_send![credential, transports];
            strings(list)
        } else {
            vec!["usb".to_owned()]
        };
        return Ok(Outcome::Registration(Registration {
            credential_id: bytes(credential_id),
            client_data_json: bytes(client_data),
            attestation_object: bytes(attestation),
            attachment,
            transports,
        }));
    }
    if responds(credential, sel!(rawAuthenticatorData)) {
        let authenticator_data: Id = msg_send![credential, rawAuthenticatorData];
        let signature: Id = msg_send![credential, signature];
        let user: Id = msg_send![credential, userID];
        let user = bytes(user);
        return Ok(Outcome::Assertion(Assertion {
            credential_id: bytes(credential_id),
            client_data_json: bytes(client_data),
            authenticator_data: bytes(authenticator_data),
            signature: bytes(signature),
            user_handle: (!user.is_empty()).then_some(user),
            attachment,
        }));
    }
    Err(KiriError::not_allowed("The authenticator returned an unexpected credential."))
}

extern "C" fn completed(_delegate: &Object, _selector: Sel, _controller: Id, authorization: Id) {
    unsafe {
        let credential: Id = if authorization.is_null() {
            std::ptr::null_mut()
        } else {
            msg_send![authorization, credential]
        };
        finish(read(credential));
    }
}

extern "C" fn failed(_delegate: &Object, _selector: Sel, _controller: Id, error: Id) {
    unsafe {
        let code: isize = if error.is_null() { 1000 } else { msg_send![error, code] };
        finish(Err(match code {
            // ASAuthorizationErrorMatchedExcludedCredential
            1006 => KiriError::invalid_state("This authenticator already has a passkey for this account."),
            _ => KiriError::not_allowed("The request was canceled or not allowed."),
        }));
    }
}

extern "C" fn anchor(_delegate: &Object, _selector: Sel, _controller: Id) -> Id {
    unsafe {
        let Some(application) = Class::get("NSApplication") else {
            return std::ptr::null_mut();
        };
        let application: Id = msg_send![application, sharedApplication];
        let key: Id = msg_send![application, keyWindow];
        if !key.is_null() {
            return key;
        }
        let main: Id = msg_send![application, mainWindow];
        if !main.is_null() {
            return main;
        }
        let windows: Id = msg_send![application, windows];
        msg_send![windows, firstObject]
    }
}
