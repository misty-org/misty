use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::CFString;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
}

const SHARING_BARS: &[&str] = &[
    "is sharing your screen",
    "is sharing a window",
    "is sharing this tab",
    "you are screen sharing",
    "share toolbar",
    "share statusbar",
    "sharing control bar",
    "you're sharing your screen",
];

fn remote_session() -> bool {
    // SAFETY: a copy the caller owns, or null outside a window-server session.
    let session = unsafe { CGSessionCopyCurrentDictionary() };
    if session.is_null() {
        return false;
    }
    // SAFETY: the create rule matches the copy above.
    let session: CFDictionary<CFString, CFType> =
        unsafe { TCFType::wrap_under_create_rule(session) };
    session
        .find(CFString::from_static_string("CGSSessionScreenIsShared"))
        .and_then(|value| value.downcast::<CFBoolean>())
        .is_some_and(bool::from)
}

fn sharing_bar() -> bool {
    crate::agents::cursor::macos::support::on_screen_windows()
        .into_iter()
        .any(|window| {
            let title = window.title.to_lowercase();
            SHARING_BARS.iter().any(|bar| title.contains(bar))
        })
}

pub(super) fn shared() -> bool {
    remote_session() || sharing_bar()
}
