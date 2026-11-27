use serde_json::{json, Value};

use crate::{rejected, PageHost};

const ACTIONS: [&str; 5] = ["list", "get", "set", "delete", "clear"];

fn page_host(address: Option<String>) -> Option<String> {
    let address = address?;
    let rest = address.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let host = if host.starts_with('[') {
        host.split_inclusive(']').next()?
    } else {
        host.split(':').next()?
    };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

pub async fn storage(host: &impl PageHost, input: &Value) -> Result<Value, String> {
    let action = input["action"].as_str().unwrap_or("list");
    if !ACTIONS.contains(&action) {
        return Ok(rejected(
            "browser_storage_invalid",
            "action is list, get, set, delete or clear.",
        ));
    }
    let named = input["name"].as_str().is_some_and(|name| !name.is_empty());
    if matches!(action, "get" | "set" | "delete") && !named {
        return Ok(rejected("browser_storage_invalid", "Name the item."));
    }
    match input["store"].as_str().unwrap_or("cookies") {
        "cookies" => {
            let mut request = json!({"action": action});
            for field in [
                "name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite",
            ] {
                if !input[field].is_null() {
                    request[field] = input[field].clone();
                }
            }
            if action == "set" && request["domain"].as_str().is_none_or(str::is_empty) {
                match page_host(host.url()) {
                    Some(domain) => request["domain"] = json!(domain),
                    None => {
                        return Ok(rejected(
                            "browser_storage_invalid",
                            "Give the cookie a domain: the page has no host of its own.",
                        ))
                    }
                }
            }
            match host.cookies(request).await {
                Ok(answer) => Ok(answer),
                Err(error) => Ok(rejected("browser_storage_failed", &error)),
            }
        }
        store @ ("local" | "session") => {
            let mut args = json!({"store": store, "action": action});
            for field in ["name", "value"] {
                if !input[field].is_null() {
                    args[field] = input[field].clone();
                }
            }
            host.call(None, "storage", args, false).await
        }
        _ => Ok(rejected(
            "browser_storage_invalid",
            "store is cookies, local or session.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::page_host;

    #[test]
    fn reads_the_page_host() {
        assert_eq!(
            page_host(Some("https://Shop.Example.com:8443/cart?x=1".into())).as_deref(),
            Some("shop.example.com")
        );
        assert_eq!(
            page_host(Some("http://user@127.0.0.1:5000/".into())).as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(page_host(Some("about:blank".into())), None);
        assert_eq!(page_host(None), None);
    }
}
