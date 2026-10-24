//! Overriding the main webview's pointer event methods so events over a page reach the page.
use super::*;

pub(super) unsafe fn install_pointer_event_overrides(class: &AnyClass) {
    // `mouseExited:` must still clear hover state when the pointer leaves an
    // uncovered part of the main renderer.
    for selector in [
        objc2::sel!(mouseMoved:),
        objc2::sel!(mouseEntered:),
        objc2::sel!(cursorUpdate:),
    ] {
        install_pointer_event_override(class, selector);
    }
}

pub(super) unsafe fn install_pointer_event_override(class: &AnyClass, selector: Sel) {
    unsafe extern "C" {
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            imp: Imp,
            types: *const c_char,
        ) -> c_uchar;
        fn method_getTypeEncoding(method: *const Method) -> *const c_char;
    }

    let Ok(mut implementations) = pointer_event_implementations().lock() else {
        return;
    };
    let class_key = class as *const AnyClass as usize;
    if implementations.contains_key(&(class_key, selector)) {
        return;
    }
    let Some(method) = class.instance_method(selector) else {
        return;
    };
    let replacement: unsafe extern "C-unwind" fn(_, _, _) = pointer_event;
    let replacement: Imp = std::mem::transmute(replacement);
    let types = method_getTypeEncoding(method);
    if class_addMethod(class, selector, replacement, types) != 0 {
        implementations.insert((class_key, selector), method.implementation() as usize);
        return;
    }
    if let Some(own_method) = class
        .instance_methods()
        .iter()
        .find(|candidate| candidate.name() == selector)
    {
        let previous = own_method.set_implementation(replacement);
        implementations.insert((class_key, selector), previous as usize);
    }
}

unsafe extern "C-unwind" fn pointer_event(this: &AnyObject, command: Sel, event: &NSEvent) {
    let browser_root = browser_tracking_owners()
        .lock()
        .ok()
        .and_then(|owners| owners.get(&(this as *const AnyObject as usize)).copied());
    if browser_root.is_some_and(|root| browser_is_below_renderer(root)) {
        return;
    }
    let belongs_to_main = main_tracking_owners()
        .lock()
        .map(|owners| owners.contains(&(this as *const AnyObject as usize)))
        .unwrap_or(false);
    if !belongs_to_main || !browser_child_covers_event(event) {
        call_original_pointer_event(this, command, event);
    }
}

pub(super) unsafe fn browser_child_covers_event(event: &NSEvent) -> bool {
    let Some(main_pointer) = MAIN_WEBVIEW_VIEW.get().copied() else {
        return false;
    };
    let main: &NSView = &*(main_pointer as *const NSView);
    let Some(parent) = main.superview() else {
        return false;
    };
    let subviews = parent.subviews();
    let Some(main_index) = subviews
        .iter()
        .position(|candidate| std::ptr::eq(&*candidate as *const NSView, main as *const NSView))
    else {
        return false;
    };
    let point = parent.convertPoint_fromView(event.locationInWindow(), None);
    let Ok(browser_views) = browser_webview_views().lock() else {
        return false;
    };
    browser_views.iter().any(|browser_pointer| {
        let browser: &NSView = &*(*browser_pointer as *const NSView);
        if browser.isHidden() {
            return false;
        }
        let Some(browser_parent) = browser.superview() else {
            return false;
        };
        if !std::ptr::eq(&*browser_parent, &*parent) {
            return false;
        }
        let browser_is_above_main = subviews.iter().enumerate().any(|(index, candidate)| {
            index > main_index
                && std::ptr::eq(&*candidate as *const NSView, browser as *const NSView)
        });
        if !browser_is_above_main {
            return false;
        }
        let frame = browser.frame();
        point.x >= frame.origin.x
            && point.y >= frame.origin.y
            && point.x < frame.origin.x + frame.size.width
            && point.y < frame.origin.y + frame.size.height
    })
}

pub(super) unsafe fn call_original_pointer_event(this: &AnyObject, command: Sel, event: &NSEvent) {
    let object_key = this as *const AnyObject as usize;
    let after_class = POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch
            .borrow()
            .iter()
            .rev()
            .find(|(object, selector, _)| *object == object_key && *selector == command)
            .map(|(_, _, class)| *class)
    });
    let Some((class_key, implementation)) =
        original_pointer_event_implementation(this, command, after_class)
    else {
        return;
    };
    POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch.borrow_mut().push((object_key, command, class_key));
    });
    let original: unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent) =
        std::mem::transmute(implementation);
    original(this, command, event);
    POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch.borrow_mut().pop();
    });
}

pub(super) fn original_pointer_event_implementation(
    object: &AnyObject,
    selector: Sel,
    after_class: Option<usize>,
) -> Option<(usize, usize)> {
    let implementations = pointer_event_implementations().lock().ok()?;
    let mut class = Some(AnyObject::class(object));
    let mut passed_previous = after_class.is_none();
    while let Some(current) = class {
        let class_key = current as *const AnyClass as usize;
        if passed_previous {
            if let Some(implementation) = implementations.get(&(class_key, selector)) {
                return Some((class_key, *implementation));
            }
        } else if Some(class_key) == after_class {
            passed_previous = true;
        }
        class = current.superclass();
    }
    None
}
