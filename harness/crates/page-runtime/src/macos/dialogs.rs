use std::{
    cell::RefCell,
    collections::HashMap,
    ffi::{c_char, c_uchar, CStr},
    sync::{Mutex, OnceLock},
};

use block2::{Block, RcBlock};
use objc2::{
    runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
    sel,
};
use objc2_foundation::NSString;
use objc2_web_kit::WKWebView;
use serde_json::{json, Value};

enum Answer {
    Alert(RcBlock<dyn Fn()>),
    Confirm(RcBlock<dyn Fn(Bool)>),
    Prompt(RcBlock<dyn Fn(*mut NSString)>),
    Leave(RcBlock<dyn Fn(Bool)>),
}

struct Held {
    kind: &'static str,
    message: String,
    default_text: Option<String>,
    answer: Answer,
}

#[derive(Default)]
struct Tab {
    holding: bool,
    held: Option<Held>,
}

thread_local! {
    static TABS: RefCell<HashMap<usize, Tab>> = RefCell::new(HashMap::new());
}

type Listener = Box<dyn Fn(usize) + Send + Sync>;

fn listeners() -> &'static Mutex<Vec<Listener>> {
    static LISTENERS: OnceLock<Mutex<Vec<Listener>>> = OnceLock::new();
    LISTENERS.get_or_init(Default::default)
}

pub fn view_id(view: &WKWebView) -> usize {
    view as *const WKWebView as usize
}

pub fn on_held(listener: impl Fn(usize) + Send + Sync + 'static) {
    if let Ok(mut all) = listeners().lock() {
        all.push(Box::new(listener));
    }
}

pub fn hold(view: &WKWebView, on: bool) {
    TABS.with(|tabs| tabs.borrow_mut().entry(view_id(view)).or_default().holding = on);
}

pub fn held(view: &WKWebView) -> Option<Value> {
    TABS.with(|tabs| {
        tabs.borrow()
            .get(&view_id(view))
            .and_then(|tab| tab.held.as_ref())
            .map(|held| {
                let mut described =
                    json!({"kind": held.kind, "message": held.message, "held": true});
                if let Some(text) = &held.default_text {
                    described["defaultText"] = json!(text);
                }
                described
            })
    })
}

pub fn answer(view: &WKWebView, accept: bool, text: Option<&str>) -> Option<Value> {
    let held = TABS.with(|tabs| {
        tabs.borrow_mut()
            .get_mut(&view_id(view))
            .and_then(|tab| tab.held.take())
    })?;
    let mut answered = json!({"kind": held.kind, "message": held.message, "accepted": accept || held.kind == "alert"});
    match held.answer {
        Answer::Alert(handler) => handler.call(()),
        Answer::Confirm(handler) | Answer::Leave(handler) => handler.call((Bool::new(accept),)),
        Answer::Prompt(handler) => {
            let reply = accept.then(|| {
                let given = text
                    .map(str::to_owned)
                    .or(held.default_text)
                    .unwrap_or_default();
                answered["text"] = json!(given);
                NSString::from_str(&given)
            });
            let pointer = reply.as_ref().map_or(std::ptr::null_mut(), |reply| {
                &**reply as *const NSString as *mut NSString
            });
            handler.call((pointer,));
        }
    }
    Some(answered)
}

fn text(value: *mut NSString) -> String {
    if value.is_null() {
        return String::new();
    }
    // SAFETY: WebKit passes a valid NSString when it passes one at all.
    let text = unsafe { &*value }.to_string();
    text.chars().take(500).collect()
}

fn take(
    web_view: *mut AnyObject,
    kind: &'static str,
    message: String,
    default_text: Option<String>,
    answer: Answer,
) -> Option<Answer> {
    let id = web_view as usize;
    let holding = TABS.with(|tabs| {
        tabs.borrow()
            .get(&id)
            .is_some_and(|tab| tab.holding && tab.held.is_none())
    });
    if !holding {
        return Some(answer);
    }
    TABS.with(|tabs| {
        tabs.borrow_mut().entry(id).or_default().held = Some(Held {
            kind,
            message,
            default_text,
            answer,
        });
    });
    if let Ok(all) = listeners().lock() {
        for listener in all.iter() {
            listener(id);
        }
    }
    None
}

unsafe extern "C-unwind" fn alert(
    _: &AnyObject,
    _: Sel,
    web_view: *mut AnyObject,
    message: *mut NSString,
    _: *mut AnyObject,
    handler: *mut Block<dyn Fn()>,
) {
    let Some(handler) = (unsafe { RcBlock::copy(handler) }) else {
        return;
    };
    if let Some(Answer::Alert(handler)) = take(
        web_view,
        "alert",
        text(message),
        None,
        Answer::Alert(handler),
    ) {
        handler.call(());
    }
}

unsafe extern "C-unwind" fn confirm(
    _: &AnyObject,
    _: Sel,
    web_view: *mut AnyObject,
    message: *mut NSString,
    _: *mut AnyObject,
    handler: *mut Block<dyn Fn(Bool)>,
) {
    let Some(handler) = (unsafe { RcBlock::copy(handler) }) else {
        return;
    };
    if let Some(Answer::Confirm(handler)) = take(
        web_view,
        "confirm",
        text(message),
        None,
        Answer::Confirm(handler),
    ) {
        handler.call((Bool::NO,));
    }
}

unsafe extern "C-unwind" fn prompt(
    _: &AnyObject,
    _: Sel,
    web_view: *mut AnyObject,
    message: *mut NSString,
    default_text: *mut NSString,
    _: *mut AnyObject,
    handler: *mut Block<dyn Fn(*mut NSString)>,
) {
    let Some(handler) = (unsafe { RcBlock::copy(handler) }) else {
        return;
    };
    let fallback = (!default_text.is_null()).then(|| text(default_text));
    if let Some(Answer::Prompt(handler)) = take(
        web_view,
        "prompt",
        text(message),
        fallback,
        Answer::Prompt(handler),
    ) {
        handler.call((std::ptr::null_mut(),));
    }
}

unsafe extern "C-unwind" fn leave(
    _: &AnyObject,
    _: Sel,
    web_view: *mut AnyObject,
    message: *mut NSString,
    _: *mut AnyObject,
    handler: *mut Block<dyn Fn(Bool)>,
) {
    let Some(handler) = (unsafe { RcBlock::copy(handler) }) else {
        return;
    };
    if let Some(Answer::Leave(handler)) = take(
        web_view,
        "beforeunload",
        text(message),
        None,
        Answer::Leave(handler),
    ) {
        handler.call((Bool::YES,));
    }
}

unsafe fn add(class: &AnyClass, selector: Sel, imp: Imp, types: &CStr) {
    unsafe extern "C" {
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            imp: Imp,
            types: *const c_char,
        ) -> c_uchar;
    }
    if class
        .instance_methods()
        .iter()
        .any(|method| method.name() == selector)
    {
        return;
    }
    // SAFETY: the class is a live Objective-C class and the types match the implementation.
    unsafe { class_addMethod(class, selector, imp, types.as_ptr()) };
}

pub fn install(view: &WKWebView) {
    static DONE: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    // SAFETY: on the main thread, reading the web view's own delegate.
    let Some(delegate) = (unsafe { view.UIDelegate() }) else {
        return;
    };
    let object: &AnyObject = delegate.as_ref();
    let class = object.class();
    let Ok(mut done) = DONE.lock() else {
        return;
    };
    if done.contains(&(class as *const AnyClass as usize)) {
        return;
    }
    done.push(class as *const AnyClass as usize);
    type Alert = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        *mut AnyObject,
        *mut NSString,
        *mut AnyObject,
        *mut Block<dyn Fn()>,
    );
    type Confirm = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        *mut AnyObject,
        *mut NSString,
        *mut AnyObject,
        *mut Block<dyn Fn(Bool)>,
    );
    type Prompt = unsafe extern "C-unwind" fn(
        &AnyObject,
        Sel,
        *mut AnyObject,
        *mut NSString,
        *mut NSString,
        *mut AnyObject,
        *mut Block<dyn Fn(*mut NSString)>,
    );
    // SAFETY: each implementation has the signature WebKit calls its selector with.
    unsafe {
        add(
            class,
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<Alert, Imp>(alert),
            c"v@:@@@@?",
        );
        add(
            class,
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<Confirm, Imp>(confirm),
            c"v@:@@@@?",
        );
        add(
            class,
            sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:),
            std::mem::transmute::<Prompt, Imp>(prompt),
            c"v@:@@@@@?",
        );
        add(
            class,
            sel!(_webView:runBeforeUnloadConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<Confirm, Imp>(leave),
            c"v@:@@@@?",
        );
    }
    drop(done);
    refresh(view);
}

pub fn refresh(view: &WKWebView) {
    // SAFETY: on the main thread; setting the same delegate again makes WebKit look up its methods anew.
    unsafe {
        if let Some(delegate) = view.UIDelegate() {
            view.setUIDelegate(Some(&delegate));
        }
    }
}
