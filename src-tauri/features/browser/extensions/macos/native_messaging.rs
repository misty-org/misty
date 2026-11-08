// SPDX-License-Identifier: MIT
//! Native messaging: an extension talks to a companion program over stdin and stdout,
//! four-byte length-prefixed JSON frames, as in Firefox and Chrome.
use super::{
    host::MistyExtensionHost,
    native_connection::NativeConnection,
    support::{error, on_main_after, string, to_json, to_object},
};
use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, Message as _};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKWebExtensionContext, WKWebExtensionMessagePort};
use serde_json::Value;
use std::{cell::Cell, rc::Rc, time::Duration};

impl MistyExtensionHost {
    /// A new connection for an extension that may use native messaging. At most 16 stay open.
    fn native_connection(
        &self,
        application: &str,
        context: &WKWebExtensionContext,
    ) -> Result<Rc<NativeConnection>, Retained<NSError>> {
        // SAFETY: permission query on a loaded context.
        if !unsafe { context.hasPermission(&string("nativeMessaging")) } {
            return Err(error("Native messaging permission is required."));
        }
        let Some(owner) = self.identifier_of(context) else {
            return Err(error("This extension is no longer running."));
        };
        {
            let mut state = self.state_mut();
            let connections = state.native_connections.entry(owner.clone()).or_default();
            connections.retain(|connection| connection.is_running());
            if connections.len() >= 16 {
                return Err(error(
                    "This extension has too many native connections open.",
                ));
            }
        }
        // SAFETY: reads the extension's unique identifier.
        let extension = unsafe { context.uniqueIdentifier() }.to_string();
        let connection = NativeConnection::connect(application, &extension)
            .map_err(|message| error(&message))?;
        self.state_mut()
            .native_connections
            .entry(owner)
            .or_default()
            .push(connection.clone());
        Ok(connection)
    }

    /// `runtime.sendNativeMessage`: one message out, the first answer back.
    pub(super) fn send_native_message(
        &self,
        message: &AnyObject,
        application: Option<&NSString>,
        context: &WKWebExtensionContext,
        reply: &block2::DynBlock<dyn Fn(*mut AnyObject, *mut NSError)>,
    ) {
        let respond = |value: Option<Value>, failure: Option<Retained<NSError>>| {
            let object = value.and_then(|value| to_object(&value));
            reply.call((
                object.as_ref().map_or(std::ptr::null_mut(), |object| {
                    Retained::as_ptr(object).cast_mut()
                }),
                failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                    Retained::as_ptr(failure).cast_mut()
                }),
            ));
        };
        let application = application.map(|name| name.to_string()).unwrap_or_default();
        let connection = match self.native_connection(&application, context) {
            Ok(connection) => connection,
            Err(failure) => return respond(None, Some(failure)),
        };
        let reply = reply.copy();
        let replied = Rc::new(Cell::new(false));
        let answer = {
            let (replied, reply) = (replied.clone(), reply.clone());
            move |value: Option<Value>, failure: Option<String>| {
                if replied.replace(true) {
                    return;
                }
                let object = value.and_then(|value| to_object(&value));
                let failure = failure.map(|message| error(&message));
                reply.call((
                    object.as_ref().map_or(std::ptr::null_mut(), |object| {
                        Retained::as_ptr(object).cast_mut()
                    }),
                    failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                        Retained::as_ptr(failure).cast_mut()
                    }),
                ));
            }
        };
        let (done, stopper) = (answer.clone(), connection.clone());
        connection.receive(Rc::new(move |incoming| {
            match incoming {
                Ok(value) => done(Some(value), None),
                Err(message) => done(None, Some(message)),
            }
            stopper.stop();
        }));
        connection.send(&to_json(message));
        let waiting = connection.clone();
        on_main_after(Duration::from_secs(30), move || {
            if !replied.get() {
                answer(None, Some("The native application did not respond.".into()));
                waiting.stop();
            }
        });
    }

    /// `runtime.connectNative`: a long-lived port between the extension and the program.
    pub(super) fn connect_native_port(
        &self,
        port: &WKWebExtensionMessagePort,
        context: &WKWebExtensionContext,
        done: &block2::DynBlock<dyn Fn(*mut NSError)>,
    ) {
        // SAFETY: reads the port's application name.
        let application = unsafe { port.applicationIdentifier() }
            .map(|name| name.to_string())
            .unwrap_or_default();
        let connection = match self.native_connection(&application, context) {
            Ok(connection) => connection,
            Err(failure) => return done.call((Retained::as_ptr(&failure).cast_mut(),)),
        };
        let port_out = port.retain();
        connection.receive(Rc::new(move |incoming| {
            // SAFETY: the port is retained for as long as the connection listens.
            unsafe {
                match incoming {
                    Err(message) => port_out.disconnectWithError(Some(&error(&message))),
                    Ok(value) => {
                        if let Some(object) = to_object(&value) {
                            port_out.sendMessage_completionHandler(Some(&object), None);
                        }
                    }
                }
            }
        }));
        let sender = connection.clone();
        let messages = RcBlock::new(move |message: *mut AnyObject, failure: *mut NSError| {
            if !failure.is_null() {
                sender.stop();
            } else if let Some(message) = unsafe { message.as_ref() } {
                sender.send(&to_json(message));
            }
        });
        let stopper = connection.clone();
        let disconnected = RcBlock::new(move |_failure: *mut NSError| stopper.stop());
        // SAFETY: WebKit copies the handlers it is given.
        unsafe {
            port.setMessageHandler(Some(&messages));
            port.setDisconnectHandler(Some(&disconnected));
        }
        done.call((std::ptr::null_mut(),));
    }
}
