use crate::host::PageHost;
use serde_json::{json, Value};
use std::time::Instant;

pub const SNAPSHOT_CHARS: u64 = 24_000;

pub enum Go<'a> {
    Address(&'a str),
    Back,
    Forward,
    Reload,
}

impl Go<'_> {
    pub fn history(name: &str) -> Option<Go<'static>> {
        match name {
            "back" => Some(Go::Back),
            "forward" => Some(Go::Forward),
            "reload" => Some(Go::Reload),
            _ => None,
        }
    }

    fn word(&self) -> &'static str {
        match self {
            Go::Address(_) => "there",
            Go::Back => "back",
            Go::Forward => "forward",
            Go::Reload => "reload",
        }
    }
}

pub async fn mark_document<H: PageHost>(host: &H) -> Option<String> {
    let token = host.fresh_id();
    let marked = host
        .call(None, "mark", json!({ "token": token }), false)
        .await
        .ok()?;
    (marked["ok"] == true).then_some(token)
}

pub async fn still_marked<H: PageHost>(host: &H, mark: Option<&str>) -> Option<bool> {
    let token = mark?;
    let check = host.call(None, "waitCheck", json!({}), false).await.ok()?;
    Some(check["mark"].as_str() == Some(token))
}

pub async fn landed<H: PageHost>(
    host: &H,
    previous: &str,
    target: &str,
    mark: Option<&str>,
) -> Option<Value> {
    let started = Instant::now();
    let mut arrived;
    let mut challenge;
    loop {
        host.sleep(300).await;
        let url = host.url();
        let check = host.call(None, "waitCheck", json!({}), false).await.ok();
        let ready = check.as_ref().is_some_and(|check| check["ready"] == true);
        challenge = check
            .as_ref()
            .is_some_and(|check| check["challenge"] == true);
        let fragment = previous != target && url.as_deref() == Some(target);
        arrived = match mark {
            Some(token) => {
                fragment
                    || check
                        .as_ref()
                        .is_some_and(|check| check["mark"].as_str() != Some(token))
            }
            None => {
                url.as_deref() != Some(previous)
                    || (previous == target && started.elapsed().as_millis() > 1200)
            }
        };
        let elapsed = started.elapsed().as_secs();
        if (arrived && ready && !(challenge && elapsed < 20))
            || elapsed > if arrived { 25 } else { 15 }
        {
            break;
        }
    }
    let _ = host
        .call(
            None,
            "settle",
            json!({"quietMs": 400, "maxMs": 3000}),
            false,
        )
        .await;
    let declined = host.before_read().await;
    let args = json!({"candidateId": host.fresh_id(), "maxChars": SNAPSHOT_CHARS, "maxRefs": 800});
    let mut snapshot = host.call(None, "snapshot", args, true).await.ok()?;
    if let Some(label) = declined {
        snapshot["consentDeclined"] = json!(label);
    }
    host.with_frame_trees(&mut snapshot).await;
    let note = if !arrived {
        Some(format!("This tab still shows the page it was on: {target} did not load (the address may not exist, or the site is slow). Check the address, or search for the site to find its real one."))
    } else if challenge {
        Some("This site is showing a bot check that did not clear by waiting. Do not try to solve it: try another page of the site, a search result that links into it, or another source.".to_owned())
    } else {
        None
    };
    if let (Some(note), Some(tree)) = (note, snapshot["tree"].as_str()) {
        snapshot["tree"] = json!(format!("- note: {note}\n{tree}"));
    }
    (snapshot["ok"] == true).then(|| {
        json!({"documentId": snapshot["documentId"], "url": snapshot["url"], "title": snapshot["title"],
            "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"],
            "consentDeclined": snapshot["consentDeclined"], "loaded": arrived})
    })
}

pub async fn navigate<H: PageHost>(
    host: &H,
    go: Go<'_>,
    include_snapshot: bool,
) -> Result<Value, String> {
    let previous = host.url().unwrap_or_default();
    let history = !matches!(go, Go::Address(_));
    let mark = if include_snapshot || history {
        mark_document(host).await
    } else {
        None
    };
    let word = go.word();
    let reload = matches!(go, Go::Reload);
    let target = match &go {
        Go::Address(address) => (*address).to_owned(),
        _ => previous.clone(),
    };
    host.go(go)?;
    if !history {
        let mut landed_at = json!({"ok": true, "url": target});
        if include_snapshot {
            if let Some(snapshot) = landed(host, &previous, &target, mark.as_deref()).await {
                if snapshot["url"].is_string() {
                    landed_at["url"] = snapshot["url"].clone();
                }
                landed_at["snapshot"] = snapshot;
            }
        }
        return Ok(landed_at);
    }
    let snapshot = landed(host, &previous, &previous, None).await;
    let now = host.url().unwrap_or_default();
    let moved =
        reload || now != previous || still_marked(host, mark.as_deref()).await == Some(false);
    let mut answer = json!({"ok": true, "url": now, "moved": moved});
    if !moved {
        answer["note"] = json!(format!(
            "There was no page to go {word} to; the tab stayed where it was."
        ));
    }
    if let Some(snapshot) = snapshot {
        answer["snapshot"] = snapshot;
    }
    Ok(answer)
}
