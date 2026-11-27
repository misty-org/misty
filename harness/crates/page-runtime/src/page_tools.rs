use serde_json::{json, Value};

use crate::{rejected, step::consequence_gate, PageHost};

fn kind_of(words: &str) -> &'static str {
    let words = words.to_ascii_lowercase();
    let has = |list: &[&str]| list.iter().any(|word| words.contains(word));
    if has(&[
        "pay",
        "buy",
        "purchase",
        "checkout",
        "order",
        "subscribe",
        "donate",
    ]) {
        "payment"
    } else if has(&["delete", "remove", "erase", "destroy", "cancel"]) {
        "delete"
    } else if has(&["send", "message", "email", "reply", "comment", "invite"]) {
        "send"
    } else if has(&["publish", "post", "share", "tweet", "upload"]) {
        "publish"
    } else {
        ""
    }
}

pub async fn page_tools(host: &impl PageHost, input: &Value) -> Result<Value, String> {
    let listed = host.call(None, "pageTools", json!({}), false).await?;
    if input["action"].as_str().unwrap_or("list") == "list" {
        return Ok(json!({"ok": true, "tools": listed["tools"]}));
    }
    if input["action"] != "call" {
        return Ok(rejected(
            "browser_page_tool_invalid",
            "action is list or call.",
        ));
    }
    let Some(name) = input["name"].as_str().filter(|name| !name.is_empty()) else {
        return Ok(rejected(
            "browser_page_tool_invalid",
            "Name the page's tool to call.",
        ));
    };
    let Some(tool) = listed["tools"]
        .as_array()
        .and_then(|tools| tools.iter().find(|tool| tool["name"] == name))
    else {
        return Ok(rejected(
            "browser_page_tool_missing",
            format!("This page has no tool called {name}. List them first."),
        ));
    };
    if tool["annotations"]["readOnlyHint"] != true {
        let words = format!(
            "{name} {} {}",
            tool["title"].as_str().unwrap_or(""),
            tool["description"].as_str().unwrap_or("")
        );
        let kind = kind_of(&words);
        let prepared = json!({
            "consequenceKind": kind,
            "describe": format!("the page's tool {name}"),
            "consequence": format!("The page's tool {name} may change things on the site."),
        });
        let allow = input["allowConsequential"] == true;
        if let Some(refused) = consequence_gate(host, &prepared, allow).await {
            return Ok(
                json!({"status": "failure", "attempted": false, "tool_error": {"code": refused["errorCode"], "message": refused["error"]}}),
            );
        }
    }
    let args = if input["args"].is_object() {
        input["args"].clone()
    } else {
        json!({})
    };
    let answer = host
        .call(
            None,
            "pageToolCall",
            json!({"name": name, "args": args}),
            false,
        )
        .await?;
    if answer["ok"] != true {
        return Ok(rejected(
            answer["errorCode"]
                .as_str()
                .unwrap_or("browser_page_tool_failed"),
            answer["error"]
                .as_str()
                .unwrap_or("The page's tool failed."),
        ));
    }
    let mut out =
        json!({"ok": true, "result": answer["result"], "contentTrust": "untrusted-web-page"});
    if answer["truncated"] == true {
        out["truncated"] = json!(true);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::kind_of;

    #[test]
    fn names_what_a_tool_would_do() {
        assert_eq!(kind_of("place_order Buy the cart"), "payment");
        assert_eq!(kind_of("send_message"), "send");
        assert_eq!(kind_of("delete_note"), "delete");
        assert_eq!(kind_of("share_link"), "publish");
        assert_eq!(kind_of("add_todo Adds an item"), "");
    }
}
