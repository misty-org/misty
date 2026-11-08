//! A small owned wrapper over the Accessibility API (`AXUIElement`), shared by
//! the agent's desktop actions, the companion's pointing, and the live check.
use std::{ffi::c_void, ptr::NonNull};

use objc2_application_services::{AXError, AXIsProcessTrusted, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFArray, CFBoolean, CFIndex, CFRange, CFRetained, CFString, CFType};
use objc2_foundation::{NSPoint, NSRect, NSSize};

/// Whether this process may use Accessibility.
pub(crate) fn trusted() -> bool {
    // SAFETY: a plain query.
    unsafe { AXIsProcessTrusted() }
}

/// One element of another app's interface (or the system-wide element).
#[derive(Clone)]
pub(crate) struct Element(CFRetained<AXUIElement>);

impl Element {
    pub(crate) fn system_wide() -> Self {
        // SAFETY: returns a new system-wide element.
        Self(unsafe { AXUIElement::new_system_wide() })
    }

    #[cfg(test)]
    pub(crate) fn application(pid: i32) -> Self {
        // SAFETY: returns a new application element.
        Self(unsafe { AXUIElement::new_application(pid) })
    }

    /// The element under a global point, if Accessibility finds one.
    pub(crate) fn at_position(&self, x: f64, y: f64) -> Option<Element> {
        let mut found: *const AXUIElement = std::ptr::null();
        // SAFETY: `found` is a valid out pointer for the call.
        let error = unsafe {
            self.0
                .copy_element_at_position(x as f32, y as f32, NonNull::from(&mut found))
        };
        if error != AXError::Success {
            return None;
        }
        let found = NonNull::new(found.cast_mut())?;
        // SAFETY: the copy function returns a +1 reference.
        Some(Element(unsafe { CFRetained::from_raw(found) }))
    }

    pub(crate) fn pid(&self) -> i32 {
        let mut pid: i32 = 0;
        // SAFETY: `pid` is a valid out pointer.
        unsafe { self.0.pid(NonNull::from(&mut pid)) };
        pid
    }

    pub(crate) fn attribute(&self, name: &str) -> Option<CFRetained<CFType>> {
        let mut value: *const CFType = std::ptr::null();
        // SAFETY: `value` is a valid out pointer for the call.
        let error = unsafe {
            self.0
                .copy_attribute_value(&CFString::from_str(name), NonNull::from(&mut value))
        };
        if error != AXError::Success {
            return None;
        }
        // SAFETY: the copy function returns a +1 reference.
        NonNull::new(value.cast_mut()).map(|value| unsafe { CFRetained::from_raw(value) })
    }

    /// A string attribute, or empty when missing or of another type.
    pub(crate) fn string(&self, name: &str) -> String {
        self.attribute(name)
            .and_then(|value| value.downcast::<CFString>().ok())
            .map(|text| text.to_string())
            .unwrap_or_default()
    }

    pub(crate) fn parent(&self) -> Option<Element> {
        self.attribute("AXParent")
            .and_then(|value| value.downcast::<AXUIElement>().ok())
            .map(Element)
    }

    #[cfg(test)]
    pub(crate) fn children(&self) -> Vec<Element> {
        self.attribute("AXChildren")
            .and_then(|value| value.downcast::<CFArray>().ok())
            .map(|list| elements(&list))
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(crate) fn windows(&self) -> Vec<Element> {
        self.attribute("AXWindows")
            .and_then(|value| value.downcast::<CFArray>().ok())
            .map(|list| elements(&list))
            .unwrap_or_default()
    }

    /// The title of the window that holds this element.
    pub(crate) fn window_title(&self) -> String {
        self.attribute("AXWindow")
            .and_then(|value| value.downcast::<AXUIElement>().ok())
            .map(|window| Element(window).string("AXTitle"))
            .unwrap_or_default()
    }

    pub(crate) fn has_action(&self, action: &str) -> bool {
        let mut names: *const CFArray = std::ptr::null();
        // SAFETY: `names` is a valid out pointer for the call.
        let error = unsafe { self.0.copy_action_names(NonNull::from(&mut names)) };
        let Some(names) = NonNull::new(names.cast_mut()).filter(|_| error == AXError::Success)
        else {
            return false;
        };
        // SAFETY: the copy function returns a +1 reference.
        let names = unsafe { CFRetained::from_raw(names) };
        (0..names.len()).any(|index| {
            // SAFETY: indexes are in range; the entries are CFStrings.
            let item = unsafe { names.value_at_index(index as CFIndex) };
            !item.is_null() && unsafe { &*item.cast::<CFString>() }.to_string() == action
        })
    }

    pub(crate) fn settable(&self, attribute: &str) -> bool {
        let mut value = 0u8;
        // SAFETY: `value` is a valid Boolean out pointer.
        let error = unsafe {
            self.0
                .is_attribute_settable(&CFString::from_str(attribute), NonNull::from(&mut value))
        };
        error == AXError::Success && value != 0
    }

    fn set(&self, attribute: &str, value: &CFType) -> bool {
        // SAFETY: both arguments are live CF objects.
        let error = unsafe {
            self.0
                .set_attribute_value(&CFString::from_str(attribute), value)
        };
        error == AXError::Success
    }

    pub(crate) fn set_bool(&self, attribute: &str, value: bool) -> bool {
        self.set(attribute, CFBoolean::new(value).as_ref())
    }

    pub(crate) fn set_string(&self, attribute: &str, value: &str) -> bool {
        self.set(attribute, CFString::from_str(value).as_ref())
    }

    /// Selects a range of characters in a text field.
    pub(crate) fn set_selected_range(&self, location: isize, length: isize) -> bool {
        let mut range = CFRange { location, length };
        // SAFETY: the range outlives the call; the value is copied.
        let value = unsafe {
            AXValue::new(
                AXValueType::CFRange,
                NonNull::from(&mut range).cast::<c_void>(),
            )
        };
        value.is_some_and(|value| self.set("AXSelectedTextRange", value.as_ref()))
    }

    pub(crate) fn perform(&self, action: &str) -> bool {
        // SAFETY: a live element and a string.
        unsafe { self.0.perform_action(&CFString::from_str(action)) == AXError::Success }
    }

    /// Per element, never on the system-wide object: that would change the timeout
    /// for every Accessibility call Misty makes, desktop control included.
    pub(crate) fn set_timeout(&self, seconds: f32) {
        // SAFETY: a live element.
        unsafe { self.0.set_messaging_timeout(seconds) };
    }

    /// The element's frame in global display points.
    pub(crate) fn frame(&self) -> Option<NSRect> {
        let position = self.attribute("AXPosition")?.downcast::<AXValue>().ok()?;
        let size = self.attribute("AXSize")?.downcast::<AXValue>().ok()?;
        let mut origin = NSPoint::new(0.0, 0.0);
        let mut extent = NSSize::new(0.0, 0.0);
        // SAFETY: the out pointers match the requested value types.
        let ok = unsafe {
            position.value(AXValueType::CGPoint, NonNull::from(&mut origin).cast())
                && size.value(AXValueType::CGSize, NonNull::from(&mut extent).cast())
        };
        ok.then(|| NSRect::new(origin, extent))
    }

    pub(crate) fn same(&self, other: &Element) -> bool {
        self.0 == other.0
    }
}

#[cfg(test)]
fn elements(list: &CFArray) -> Vec<Element> {
    (0..list.len())
        .filter_map(|index| {
            // SAFETY: indexes are in range; the entries are retained into owned values.
            let item = unsafe { list.value_at_index(index as CFIndex) };
            let item = NonNull::new(item.cast_mut().cast::<AXUIElement>())?;
            // SAFETY: the array owns the item; retaining takes our own reference.
            Some(Element(unsafe { CFRetained::retain(item) }))
        })
        .collect()
}
