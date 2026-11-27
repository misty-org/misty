use std::{cell::RefCell, ptr::NonNull, rc::Rc};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_foundation::{
    NSArray, NSDate, NSDictionary, NSHTTPCookie, NSHTTPCookieDomain, NSHTTPCookieExpires,
    NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookieSameSitePolicy, NSHTTPCookieSecure,
    NSHTTPCookieValue, NSString,
};
use objc2_web_kit::{WKHTTPCookieStore, WKWebView};
use serde_json::{json, Value};

const VALUE_LIMIT: usize = 4096;

type Done = Rc<RefCell<Option<Box<dyn FnOnce(Result<Value, String>)>>>>;

fn finish(done: &Done, result: Result<Value, String>) {
    if let Some(done) = done.borrow_mut().take() {
        done(result);
    }
}

fn clip(text: String) -> String {
    if text.len() <= VALUE_LIMIT {
        return text;
    }
    let mut end = VALUE_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

fn describe(cookie: &NSHTTPCookie) -> Value {
    let mut described = json!({
        "name": cookie.name().to_string(),
        "value": clip(cookie.value().to_string()),
        "domain": cookie.domain().to_string(),
        "path": cookie.path().to_string(),
        "httpOnly": cookie.isHTTPOnly(),
        "secure": cookie.isSecure(),
    });
    if let Some(date) = cookie.expiresDate() {
        described["expires"] = json!(date.timeIntervalSince1970().round() as i64);
    }
    if let Some(policy) = cookie.sameSitePolicy() {
        described["sameSite"] = json!(policy.to_string());
    }
    described
}

fn applies(cookie: &NSHTTPCookie, request: &Value) -> bool {
    if let Some(name) = request["name"].as_str() {
        if cookie.name().to_string() != name {
            return false;
        }
    }
    if let Some(path) = request["path"].as_str() {
        if cookie.path().to_string() != path {
            return false;
        }
    }
    match request["domain"].as_str() {
        Some(domain) => {
            let domain = domain.trim_start_matches('.').to_ascii_lowercase();
            let own = cookie.domain().to_string().to_ascii_lowercase();
            let own = own.trim_start_matches('.');
            domain == own || domain.ends_with(&format!(".{own}"))
        }
        None => true,
    }
}

fn text(value: &str) -> Retained<AnyObject> {
    Retained::into_super(Retained::into_super(NSString::from_str(value)))
}

fn made(request: &Value) -> Result<Retained<NSHTTPCookie>, String> {
    let name = request["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or("A cookie needs a name.")?;
    let domain = request["domain"]
        .as_str()
        .filter(|domain| !domain.is_empty())
        .ok_or("A cookie needs a domain.")?;
    let value = request["value"].as_str().unwrap_or("");
    let path = request["path"].as_str().unwrap_or("/");
    // SAFETY: Foundation's cookie property keys are immutable static strings.
    let (key_name, key_value, key_domain, key_path, key_secure, key_expires, key_same_site) = unsafe {
        (
            NSHTTPCookieName,
            NSHTTPCookieValue,
            NSHTTPCookieDomain,
            NSHTTPCookiePath,
            NSHTTPCookieSecure,
            NSHTTPCookieExpires,
            NSHTTPCookieSameSitePolicy,
        )
    };
    let http_only = NSString::from_str("HttpOnly");
    let mut keys: Vec<&NSString> = vec![key_name, key_value, key_domain, key_path];
    let mut objects = vec![text(name), text(value), text(domain), text(path)];
    if request["secure"] == true {
        keys.push(key_secure);
        objects.push(text("TRUE"));
    }
    if request["httpOnly"] == true {
        keys.push(&http_only);
        objects.push(text("TRUE"));
    }
    if let Some(expires) = request["expires"].as_f64() {
        keys.push(key_expires);
        objects.push(Retained::into_super(Retained::into_super(
            NSDate::dateWithTimeIntervalSince1970(expires),
        )));
    }
    if let Some(same_site) = request["sameSite"].as_str() {
        let policy = match same_site.to_ascii_lowercase().as_str() {
            "lax" => "lax",
            "strict" => "strict",
            "none" => "none",
            _ => return Err("sameSite is Lax, Strict or None.".to_owned()),
        };
        if policy != "none" {
            keys.push(key_same_site);
            objects.push(text(policy));
        }
    }
    let properties = NSDictionary::from_retained_objects(&keys, &objects);
    // SAFETY: every key is a cookie property key and every value an NSString or NSDate.
    unsafe { NSHTTPCookie::cookieWithProperties(&properties) }
        .ok_or_else(|| "WebKit refused that cookie.".to_owned())
}

fn delete_each(
    store: Retained<WKHTTPCookieStore>,
    mut left: Vec<Retained<NSHTTPCookie>>,
    removed: usize,
    done: Done,
) {
    let Some(cookie) = left.pop() else {
        finish(&done, Ok(json!({"ok": true, "removed": removed})));
        return;
    };
    let next_store = store.clone();
    let next: RefCell<Option<(Vec<Retained<NSHTTPCookie>>, Done)>> =
        RefCell::new(Some((left, done)));
    let handler = RcBlock::new(move || {
        if let Some((left, done)) = next.borrow_mut().take() {
            delete_each(next_store.clone(), left, removed + 1, done);
        }
    });
    // SAFETY: called on the main thread with a cookie WebKit gave back.
    unsafe { store.deleteCookie_completionHandler(&cookie, Some(&handler)) };
}

pub fn cookies(
    view: &WKWebView,
    request: Value,
    done: impl FnOnce(Result<Value, String>) + 'static,
) {
    let done: Done = Rc::new(RefCell::new(Some(Box::new(done))));
    // SAFETY: the live web view's configuration and data store, on the main thread.
    let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
    let action = request["action"].as_str().unwrap_or("list").to_owned();
    if action == "set" {
        let cookie = match made(&request) {
            Ok(cookie) => cookie,
            Err(error) => return finish(&done, Err(error)),
        };
        let described = describe(&cookie);
        let answered = done.clone();
        let handler = RcBlock::new(move || {
            finish(
                &answered,
                Ok(json!({"ok": true, "cookie": described.clone()})),
            )
        });
        // SAFETY: called on the main thread with a cookie built above.
        unsafe { store.setCookie_completionHandler(&cookie, Some(&handler)) };
        return;
    }
    if !matches!(action.as_str(), "list" | "get" | "delete" | "clear") {
        return finish(
            &done,
            Err("action is list, get, set, delete or clear.".to_owned()),
        );
    }
    if action == "delete" && request["name"].as_str().is_none() {
        return finish(&done, Err("Name the cookie to delete.".to_owned()));
    }
    let picked_store = store.clone();
    let handler = RcBlock::new(move |all: NonNull<NSArray<NSHTTPCookie>>| {
        // SAFETY: WebKit passes a valid array of cookies.
        let all = unsafe { all.as_ref() };
        let mut narrowed = request.clone();
        if action == "clear" {
            if let Some(object) = narrowed.as_object_mut() {
                object.remove("name");
                object.remove("path");
            }
        }
        let picked: Vec<Retained<NSHTTPCookie>> = all
            .to_vec()
            .into_iter()
            .filter(|cookie| applies(cookie, &narrowed))
            .collect();
        if action == "list" || action == "get" {
            let listed: Vec<Value> = picked.iter().map(|cookie| describe(cookie)).collect();
            finish(&done, Ok(json!({"ok": true, "cookies": listed})));
        } else {
            delete_each(picked_store.clone(), picked, 0, done.clone());
        }
    });
    // SAFETY: called on the main thread with a block WebKit calls once.
    unsafe { store.getAllCookies(&handler) };
}
