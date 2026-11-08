// SPDX-License-Identifier: MIT
//! Extension notifications through UNUserNotificationCenter. It must run inside an app bundle
//! (the runner builds one for `--notifications`), and the first run asks for notification
//! permission.
//!
//! macOS cannot be made to click a banner, so the delegate receives stand-in responses
//! carrying the delivered notification. That covers Misty's routing of clicks, buttons and
//! dismissals; the system's own delivery of a click is left to a manual check in Misty.
use super::support::{fail, require, string, Harness};
use block2::RcBlock;
use objc2::{
    define_class, msg_send, rc::Retained, runtime::NSObject, DefinedClass, MainThreadOnly, Message,
};
use objc2_foundation::{NSArray, NSBundle, NSObjectProtocol, NSSet, NSString};
use objc2_user_notifications::{
    UNNotification, UNNotificationCategory, UNNotificationDefaultActionIdentifier,
    UNNotificationDismissActionIdentifier, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use objc2_web_kit::WKWebViewConfiguration;
use serde_json::json;
use std::{
    ptr::NonNull,
    sync::{mpsc, Mutex},
};

const PROBE_STORE: &str = "6D697374-7900-4000-8000-70726F626573";

struct Stand {
    notification: Retained<UNNotification>,
    action: Retained<NSString>,
}

define_class!(
    /// The delegate reads only these two properties of a response.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Stand]
    struct StandInResponse;

    unsafe impl NSObjectProtocol for StandInResponse {}

    impl StandInResponse {
        #[unsafe(method_id(notification))]
        fn notification(&self) -> Retained<UNNotification> {
            self.ivars().notification.clone()
        }

        #[unsafe(method_id(actionIdentifier))]
        fn action_identifier(&self) -> Retained<NSString> {
            self.ivars().action.clone()
        }
    }
);

/// A value carried from a system callback thread to the main one, where it is used.
struct Carried<T>(T);
// SAFETY: the carried UserNotifications objects are only read on the main thread.
unsafe impl<T> Send for Carried<T> {}

pub fn run(root: &str) {
    let harness = Harness::new("notifications");
    require(
        NSBundle::mainBundle()
            .bundlePath()
            .to_string()
            .ends_with(".app"),
        "Run this probe from its app bundle.",
    );
    Harness::use_kiri_transport();
    let origin = Harness::random_origin();
    harness.request(json!({"operation": "configure", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string(), "store": PROBE_STORE}));
    harness.request(json!({
        "operation": "load", "id": "1", "guid": "compat-fixture@misty.test", "origin": origin, "runtimePath": root,
        "privateAccess": false, "permissions": ["notifications"], "hosts": [],
    }));
    let address = format!("webkit-extension://{origin}/notifications.html");
    // SAFETY: WebKit configuration on the main thread.
    let original = unsafe { WKWebViewConfiguration::new(harness.mtm) };
    let page = harness.view_with(&original, &address, "notifications", false, true);
    harness.spin(2.0);
    eprintln!("Posting a test notification. Allow notifications if macOS asks.");
    let evaluate = |script: &str| {
        harness
            .eval(&page, script, &json!({}))
            .unwrap_or_else(|e| fail(format!("{script} failed: {e}")))
    };
    require(
        evaluate("return await window.createNotification()") == "probe",
        "create did not return its name",
    );
    require(
        evaluate("return JSON.stringify(await browser.notifications.getAll())")
            == "{\"probe\":true}",
        "getAll was wrong",
    );

    // The notification the system delivered, its image and its buttons.
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (send, receive) = mpsc::channel();
    let send = Mutex::new(send);
    let delivered = RcBlock::new(move |notifications: NonNull<NSArray<UNNotification>>| {
        // SAFETY: UserNotifications passes a live array.
        let found = unsafe { notifications.as_ref() }.iter().find(|n| {
            n.request()
                .content()
                .userInfo()
                .objectForKey(&string("mistyNotification"))
                .is_some_and(|v| {
                    v.downcast_ref::<NSString>()
                        .is_some_and(|s| s.to_string() == "probe")
                })
        });
        let _ = send.lock().unwrap().send(Carried(found));
    });
    center.getDeliveredNotificationsWithCompletionHandler(&delivered);
    let mut notification = None;
    harness.wait_until("the delivered notification", 30.0, || {
        match receive.try_recv() {
            Ok(Carried(found)) => {
                notification = Some(found);
                true
            }
            Err(_) => false,
        }
    });
    let Some(notification) = notification.flatten() else {
        fail("The notification was not delivered")
    };
    let content = notification.request().content();
    require(
        content.title().to_string() == "Misty notification probe",
        "Delivered title was wrong",
    );
    require(
        content.attachments().count() == 1,
        "The icon was not attached",
    );
    let (send, receive) = mpsc::channel();
    let send = Mutex::new(send);
    let categories = RcBlock::new(move |set: NonNull<NSSet<UNNotificationCategory>>| {
        // SAFETY: UserNotifications passes a live set.
        let titles: Vec<(String, Vec<String>)> = unsafe { set.as_ref() }
            .allObjects()
            .iter()
            .map(|c| {
                (
                    c.identifier().to_string(),
                    c.actions().iter().map(|a| a.title().to_string()).collect(),
                )
            })
            .collect();
        let _ = send.lock().unwrap().send(titles);
    });
    center.getNotificationCategoriesWithCompletionHandler(&categories);
    let mut found = None;
    harness.wait_until("the notification categories", 30.0, || {
        match receive.try_recv() {
            Ok(all) => {
                found = Some(all);
                true
            }
            Err(_) => false,
        }
    });
    let wanted = content.categoryIdentifier().to_string();
    let titles = found
        .unwrap_or_default()
        .into_iter()
        .find(|(id, _)| *id == wanted)
        .map(|(_, titles)| titles);
    require(
        titles == Some(vec!["Yes".to_owned(), "No".to_owned()]),
        "Notification buttons were not registered",
    );

    // Routing: a click, a button and a dismissal reach the extension's events.
    let respond = |action: &NSString| {
        let stand: Retained<StandInResponse> = {
            let this = harness.mtm.alloc::<StandInResponse>().set_ivars(Stand {
                notification: notification.clone(),
                action: action.retain(),
            });
            // SAFETY: NSObject's designated initializer.
            unsafe { msg_send![super(this), init] }
        };
        let delegate = center
            .delegate()
            .unwrap_or_else(|| fail("The host installed no delegate"));
        let done = RcBlock::new(|| {});
        // SAFETY: the stand-in answers the two selectors the delegate reads.
        let response = unsafe { &*(Retained::as_ptr(&stand) as *const UNNotificationResponse) };
        delegate.userNotificationCenter_didReceiveNotificationResponse_withCompletionHandler(
            &center, response, &done,
        );
    };
    // SAFETY: UserNotifications' immortal identifier constants.
    unsafe {
        respond(UNNotificationDefaultActionIdentifier);
        respond(&string("button-1"));
        respond(UNNotificationDismissActionIdentifier);
    }
    harness.spin(1.0);
    let events = evaluate("return JSON.stringify(window.notificationEvents)");
    let expected = "[[\"onShown\",\"probe\"],[\"onClicked\",\"probe\"],[\"onButtonClicked\",\"probe\",1],[\"onClosed\",\"probe\",true]]";
    require(
        events == expected,
        format!("Unexpected notification events: {events}"),
    );
    // The dismissal already forgot it, so clearing reports false.
    require(
        evaluate("return await browser.notifications.clear('probe')") == false,
        "clear was wrong",
    );
    // Notification Center removes delivered notifications asynchronously.
    harness.spin(1.0);
    require(
        evaluate("return JSON.stringify(await browser.notifications.getAll())") == "{}",
        "getAll after clear was wrong",
    );
    println!("PASS: native notification with buttons and image attachment, getAll, click/button/dismiss routing to extension events, clear");
}
