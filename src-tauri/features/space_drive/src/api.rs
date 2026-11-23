//! The server's Space drive routes (build contract, Appendix A), through an [`Http`] the glue
//! implements with Misty's own account session. Every request carries `X-Misty-Device` and
//! `X-Misty-Device-Name`. A save carries `base_version`, the version its copy came from; only a
//! merged save carries `If-Match` (`rules.rs`).
//!
//! Throttling, server errors and dropped connections are retried with backoff and the server's
//! `Retry-After`, adapted from kuragine's `cloud/http.rs` (MIT, Copyright (c) 2026 Kura
//! contributors; see `NOTICE`). A create is safe to retry: it carries the item's own id, and the
//! server answers a repeat with the item it already made.
use std::{io, pin::Pin, sync::Arc, time::Duration};

use bytes::Bytes;
use futures_util::{future::BoxFuture, Stream};
use rand::Rng;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::{InUseBy, Item, ItemId, Kind, Seq, SpaceId, TrashPage, Version};

pub type ByteStream = Pin<Box<dyn Stream<Item = io::Result<Bytes>> + Send>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum HttpError {
    #[error("Misty couldn't reach the server.")]
    Offline,
    #[error("Sign in to Misty again.")]
    SignedOut,
    #[error("{0}")]
    Other(String),
}

pub trait Http: Send + Sync {
    fn api(&self, request: Request) -> BoxFuture<'_, Result<Response, HttpError>>;
    fn put_blob(
        &self,
        url: String,
        method: String,
        headers: Vec<(String, String)>,
        length: u64,
        body: ByteStream,
    ) -> BoxFuture<'_, Result<Response, HttpError>>;
    fn get_blob(&self, url: String) -> BoxFuture<'_, Result<(u16, ByteStream), HttpError>>;
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum ApiError {
    #[error("The file changed since.")]
    VersionConflict(Box<Item>),
    #[error("The file was deleted.")]
    Trashed(Box<Item>),
    #[error("That name is taken.")]
    NameTaken(Option<Box<Item>>),
    #[error("That id is taken.")]
    IdTaken,
    #[error("The folder it goes in is gone.")]
    ParentMissing,
    #[error("Someone has it open.")]
    InUse(Vec<InUseBy>),
    #[error("The drive has to be read again.")]
    ResyncRequired,
    #[error("It isn't there any more.")]
    NotFound,
    #[error("You can't do that in this Space.")]
    Forbidden,
    #[error("Misty couldn't reach the server.")]
    Offline,
    #[error("Sign in to Misty again.")]
    SignedOut,
    #[error("The upload didn't arrive whole.")]
    UploadIncomplete,
    #[error("This server can't move files yet.")]
    TransferUnavailable,
    #[error("The server refused it ({status}): {message}")]
    Server { status: u16, message: String },
}

impl ApiError {
    pub fn is_transient(&self) -> bool {
        matches!(self, Self::Offline)
            || matches!(self, Self::Server { status, .. } if *status >= 500 || *status == 429)
    }
}

#[derive(Debug, Deserialize)]
pub struct ChangePage {
    pub items: Vec<Item>,
    pub next_since: Seq,
    #[serde(default)]
    pub more: bool,
    #[serde(default)]
    pub head: Seq,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PresignedPut {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PartUrl {
    pub number: u32,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Multipart {
    pub part_size: u64,
    pub parts: Vec<PartUrl>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct DonePart {
    pub number: u32,
    pub etag: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UploadStart {
    pub upload_id: String,
    #[serde(default)]
    pub present: bool,
    #[serde(default)]
    pub single: Option<PresignedPut>,
    #[serde(default)]
    pub multipart: Option<Multipart>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ContentUrl {
    pub url: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Lease {
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct InUseMark {
    pub item_id: ItemId,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub editing: bool,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InUseMarks {
    #[serde(default)]
    marks: Vec<InUseMark>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NewItem {
    pub id: ItemId,
    pub parent_id: Option<ItemId>,
    pub name: String,
    pub kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Change {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Option<ItemId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_version: Option<i64>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub replace: bool,
}

impl Change {
    pub fn changes_content(&self) -> bool {
        self.sha256.is_some()
    }

    pub fn changes_place(&self) -> bool {
        self.name.is_some() || self.parent_id.is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    pub id: String,
    pub name: String,
}

const MAX_ATTEMPTS: u32 = 5;
const MAX_BACKOFF: Duration = Duration::from_secs(32);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);

#[derive(Clone)]
pub struct Api {
    http: Arc<dyn Http>,
    device: Device,
    pub patient: bool,
}

const ENCODED: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

fn segment(text: &str) -> String {
    percent_encoding::utf8_percent_encode(text, ENCODED).to_string()
}

fn space_path(space: &SpaceId, rest: &str) -> String {
    format!("/spaces/{}/drive{rest}", segment(space.as_str()))
}

fn item_path(space: &SpaceId, id: &ItemId, rest: &str) -> String {
    space_path(space, &format!("/items/{}{rest}", segment(id.as_str())))
}

fn backoff(attempt: u32) -> Duration {
    let base = Duration::from_millis(500) * 2u32.saturating_pow(attempt.saturating_sub(1));
    let jitter = Duration::from_millis(rand::thread_rng().gen_range(0..500));
    base.min(MAX_BACKOFF) + jitter
}

fn retry_after(response: &Response) -> Option<Duration> {
    let seconds: u64 = response.header("retry-after")?.trim().parse().ok()?;
    Some(Duration::from_secs(seconds).min(MAX_RETRY_AFTER))
}

fn item_in(body: &Value) -> Option<Box<Item>> {
    serde_json::from_value(body.get("item")?.clone())
        .ok()
        .map(Box::new)
}

pub fn refusal(status: u16, body: &[u8]) -> ApiError {
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = value
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let message = value
        .get("message")
        .or_else(|| value.get("error"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    match (status, code) {
        (409, "version_conflict") => match item_in(&value) {
            Some(item) => ApiError::VersionConflict(item),
            None => ApiError::Server { status, message },
        },
        (409, "trashed") => match item_in(&value) {
            Some(item) => ApiError::Trashed(item),
            None => ApiError::Server { status, message },
        },
        (409, "name_taken") => ApiError::NameTaken(item_in(&value)),
        (409, "id_taken") => ApiError::IdTaken,
        (409, "blob_missing" | "upload_incomplete" | "upload_conflict") | (422, _) => {
            ApiError::UploadIncomplete
        }
        (503, "drive_direct_transfer_unavailable") => ApiError::TransferUnavailable,
        (409, "parent_not_folder") => ApiError::Server {
            status,
            message: "The folder it goes in isn't a folder.".to_owned(),
        },
        (409, "invalid_move") => ApiError::Server {
            status,
            message: "A folder can't move into itself.".to_owned(),
        },
        (404, "parent_missing") => ApiError::ParentMissing,
        (423, _) => ApiError::InUse(
            value
                .get("who")
                .and_then(|who| serde_json::from_value(who.clone()).ok())
                .unwrap_or_default(),
        ),
        (410, _) => ApiError::ResyncRequired,
        (404, _) => ApiError::NotFound,
        (401, _) => ApiError::SignedOut,
        (403, _) => ApiError::Forbidden,
        _ => ApiError::Server { status, message },
    }
}

impl Api {
    pub fn new(http: Arc<dyn Http>, device: Device) -> Self {
        Self {
            http,
            device,
            patient: true,
        }
    }

    pub fn http(&self) -> &Arc<dyn Http> {
        &self.http
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    async fn send(
        &self,
        method: Method,
        path: String,
        if_match: Option<Version>,
        body: Option<Value>,
    ) -> Result<Response, ApiError> {
        let mut headers = vec![
            ("X-Misty-Device".to_owned(), self.device.id.clone()),
            ("X-Misty-Device-Name".to_owned(), segment(&self.device.name)),
            ("Accept".to_owned(), "application/json".to_owned()),
        ];
        if let Some(version) = if_match {
            headers.push(("If-Match".to_owned(), version.0.to_string()));
        }
        let body = body.map(|value| value.to_string().into_bytes());
        if body.is_some() {
            headers.push(("Content-Type".to_owned(), "application/json".to_owned()));
        }
        let mut attempt = 0;
        loop {
            attempt += 1;
            let request = Request {
                method,
                path: path.clone(),
                headers: headers.clone(),
                body: body.clone(),
            };
            let response = match self.http.api(request).await {
                Ok(response) => response,
                Err(HttpError::Offline) if attempt < MAX_ATTEMPTS && self.patient => {
                    tokio::time::sleep(backoff(attempt)).await;
                    continue;
                }
                Err(HttpError::Offline) => return Err(ApiError::Offline),
                Err(HttpError::SignedOut) => return Err(ApiError::SignedOut),
                Err(HttpError::Other(message)) => {
                    return Err(ApiError::Server { status: 0, message })
                }
            };
            if (200..300).contains(&response.status) {
                return Ok(response);
            }
            let unavailable = response.status == 503
                && String::from_utf8_lossy(&response.body)
                    .contains("drive_direct_transfer_unavailable");
            let throttled = (response.status == 429 || response.status >= 500) && !unavailable;
            if throttled && attempt < MAX_ATTEMPTS && self.patient {
                tokio::time::sleep(retry_after(&response).unwrap_or_else(|| backoff(attempt)))
                    .await;
                continue;
            }
            return Err(refusal(response.status, &response.body));
        }
    }

    async fn json<T: DeserializeOwned>(
        &self,
        method: Method,
        path: String,
        if_match: Option<Version>,
        body: Option<Value>,
    ) -> Result<T, ApiError> {
        let response = self.send(method, path, if_match, body).await?;
        serde_json::from_slice(&response.body).map_err(|error| ApiError::Server {
            status: response.status,
            message: format!("The server's answer didn't read: {error}"),
        })
    }

    pub async fn my_name(&self) -> Option<String> {
        let me: Value = self
            .json(Method::Get, "/me".to_owned(), None, None)
            .await
            .ok()?;
        let user = me.get("user").unwrap_or(&me);
        ["display_name", "name", "username"]
            .iter()
            .find_map(|key| user.get(*key).and_then(Value::as_str))
            .filter(|name| !name.trim().is_empty())
            .map(|name| name.trim().to_owned())
    }

    pub async fn changes(
        &self,
        space: &SpaceId,
        since: Seq,
        limit: u32,
    ) -> Result<ChangePage, ApiError> {
        self.json(
            Method::Get,
            space_path(
                space,
                &format!(
                    "/changes?since={}&limit={}",
                    since.0.max(0),
                    limit.clamp(1, 1000)
                ),
            ),
            None,
            None,
        )
        .await
    }

    pub async fn item(&self, space: &SpaceId, id: &ItemId) -> Result<Item, ApiError> {
        self.json(Method::Get, item_path(space, id, ""), None, None)
            .await
    }

    pub async fn start_upload(
        &self,
        space: &SpaceId,
        sha256: &str,
        size: u64,
    ) -> Result<UploadStart, ApiError> {
        self.json(
            Method::Post,
            space_path(space, "/uploads"),
            None,
            Some(json!({ "sha256": sha256, "size": size })),
        )
        .await
    }

    pub async fn complete_upload(
        &self,
        space: &SpaceId,
        upload_id: &str,
        parts: &[DonePart],
    ) -> Result<(), ApiError> {
        self.send(
            Method::Post,
            space_path(space, &format!("/uploads/{}/complete", segment(upload_id))),
            None,
            Some(json!({ "parts": parts })),
        )
        .await
        .map(|_| ())
    }

    async fn item_answer(
        &self,
        method: Method,
        path: String,
        if_match: Option<Version>,
        body: Option<Value>,
    ) -> Result<Item, ApiError> {
        let answer: Value = self.json(method, path, if_match, body).await?;
        let item = if answer.get("id").is_some() {
            answer
        } else {
            answer.get("item").cloned().unwrap_or(Value::Null)
        };
        serde_json::from_value(item).map_err(|error| ApiError::Server {
            status: 200,
            message: format!("The server's answer didn't read: {error}"),
        })
    }

    pub async fn create(&self, space: &SpaceId, item: &NewItem) -> Result<Item, ApiError> {
        let body = serde_json::to_value(item).unwrap_or(Value::Null);
        self.item_answer(Method::Post, space_path(space, "/items"), None, Some(body))
            .await
    }

    pub async fn change(
        &self,
        space: &SpaceId,
        id: &ItemId,
        if_match: Option<Version>,
        change: &Change,
    ) -> Result<Item, ApiError> {
        let body = serde_json::to_value(change).unwrap_or(Value::Null);
        self.item_answer(
            Method::Patch,
            item_path(space, id, ""),
            if_match,
            Some(body),
        )
        .await
    }

    pub async fn check_in_use(&self, space: &SpaceId, id: &ItemId) -> Result<Duration, ApiError> {
        let answer: Value = self
            .json(
                Method::Post,
                item_path(space, id, "/check-in-use"),
                None,
                None,
            )
            .await?;
        Ok(Duration::from_millis(
            answer
                .get("wait_ms")
                .and_then(Value::as_u64)
                .unwrap_or(2000),
        ))
    }

    pub async fn trash(&self, space: &SpaceId, id: &ItemId, held: bool) -> Result<Item, ApiError> {
        self.item_answer(
            Method::Post,
            item_path(space, id, "/trash"),
            None,
            Some(json!({ "held": held })),
        )
        .await
    }

    pub async fn restore(&self, space: &SpaceId, id: &ItemId) -> Result<Item, ApiError> {
        self.item_answer(Method::Post, item_path(space, id, "/restore"), None, None)
            .await
    }

    pub async fn content_url(&self, space: &SpaceId, id: &ItemId) -> Result<ContentUrl, ApiError> {
        self.json(Method::Get, item_path(space, id, "/content"), None, None)
            .await
    }

    pub async fn mark_in_use(
        &self,
        space: &SpaceId,
        id: &ItemId,
        editing: bool,
    ) -> Result<Lease, ApiError> {
        self.json(
            Method::Put,
            item_path(space, id, "/in-use"),
            None,
            Some(json!({ "editing": editing })),
        )
        .await
    }

    pub async fn in_use_marks(&self, space: &SpaceId) -> Result<Vec<InUseMark>, ApiError> {
        let page: InUseMarks = self
            .json(Method::Get, space_path(space, "/in-use"), None, None)
            .await?;
        Ok(page.marks)
    }

    pub async fn clear_in_use(&self, space: &SpaceId, id: &ItemId) -> Result<(), ApiError> {
        self.send(Method::Delete, item_path(space, id, "/in-use"), None, None)
            .await
            .map(|_| ())
    }

    pub async fn trash_list(
        &self,
        space: &SpaceId,
        after: Option<&str>,
        limit: u32,
    ) -> Result<TrashPage, ApiError> {
        let mut path = space_path(space, &format!("/trash?limit={}", limit.clamp(1, 200)));
        if let Some(after) = after.filter(|after| !after.is_empty()) {
            path.push_str(&format!("&after={}", segment(after)));
        }
        let mut page: TrashPage = self.json(Method::Get, path, None, None).await?;
        page.next_after = page.next_after.filter(|next| !next.is_empty());
        Ok(page)
    }

    pub async fn purge(&self, space: &SpaceId, id: &ItemId) -> Result<(), ApiError> {
        self.send(Method::Delete, item_path(space, id, ""), None, None)
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_servers_refusals() {
        let item = json!({
            "id": "drv_00000000-0000-4000-8000-000000000000", "space_id": "s", "parent_id": null,
            "name": "a", "kind": "file", "version": 3, "seq": 9
        });
        let body = json!({ "code": "version_conflict", "item": item }).to_string();
        assert!(matches!(
            refusal(409, body.as_bytes()),
            ApiError::VersionConflict(_)
        ));
        let body = json!({ "code": "in_use", "who": [{ "user_id": "u", "name": "Ben",
            "device_name": "Mac", "editing": true }] })
        .to_string();
        match refusal(423, body.as_bytes()) {
            ApiError::InUse(who) => assert_eq!(who[0].name, "Ben"),
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            refusal(410, b"{\"code\":\"resync_required\"}"),
            ApiError::ResyncRequired
        ));
        assert!(matches!(
            refusal(404, b"{\"code\":\"parent_missing\"}"),
            ApiError::ParentMissing
        ));
    }

    #[test]
    fn a_move_to_the_root_sends_a_null_parent() {
        let change = Change {
            parent_id: Some(None),
            ..Change::default()
        };
        assert_eq!(
            serde_json::to_value(&change).unwrap(),
            json!({ "parent_id": null })
        );
    }

    #[test]
    fn a_save_says_what_it_came_from_and_a_rename_may_replace() {
        let change = Change {
            name: Some("Final.md".into()),
            base_version: Some(7),
            replace: true,
            ..Change::default()
        };
        assert_eq!(
            serde_json::to_value(&change).unwrap(),
            json!({ "name": "Final.md", "base_version": 7, "replace": true })
        );
        assert_eq!(serde_json::to_value(Change::default()).unwrap(), json!({}));
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        assert!(backoff(1) < Duration::from_secs(1) + Duration::from_millis(1));
        assert!(backoff(20) <= MAX_BACKOFF + Duration::from_millis(500));
    }
}
