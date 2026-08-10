use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
};

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::{
    blocking::{Body, Client, RequestBuilder, Response},
    header::{CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, LOCATION},
    Method,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use url::Url;
use uuid::Uuid;

type RemoteConfig = Map<String, Value>;

#[derive(Clone)]
pub struct DirectCloudEngine {
    inner: Arc<DirectCloudInner>,
}

struct DirectCloudInner {
    config_path: PathBuf,
    remotes: RwLock<HashMap<String, RemoteConfig>>,
    jobs: Mutex<HashMap<i64, NativeJob>>,
    next_job_id: AtomicI64,
    client: Client,
    unavailable: Option<String>,
}

#[derive(Clone, Default, Serialize)]
struct NativeJob {
    finished: bool,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl DirectCloudEngine {
    pub fn new(config_path: PathBuf) -> Result<Self, String> {
        let remotes = read_connections(&config_path)?;
        Ok(Self {
            inner: Arc::new(DirectCloudInner {
                config_path,
                remotes: RwLock::new(remotes),
                jobs: Mutex::new(HashMap::new()),
                next_job_id: AtomicI64::new(0),
                client: Client::builder()
                    .build()
                    .map_err(|error| format!("Could not initialize cloud networking: {error}"))?,
                unavailable: None,
            }),
        })
    }

    pub fn unavailable(config_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(DirectCloudInner {
                config_path,
                remotes: RwLock::new(HashMap::new()),
                jobs: Mutex::new(HashMap::new()),
                next_job_id: AtomicI64::new(0),
                client: Client::new(),
                unavailable: Some("Native cloud storage is unavailable.".to_owned()),
            }),
        }
    }

    pub fn call(&self, method: &str, mut input: Value) -> Result<Value, String> {
        if let Some(error) = &self.inner.unavailable {
            return Err(error.clone());
        }
        if input
            .get("_async")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            input
                .as_object_mut()
                .ok_or_else(|| "Storage input must be an object.".to_owned())?
                .remove("_async");
            return self.start_job(method.to_owned(), input);
        }
        self.dispatch(method, &input)
    }

    fn start_job(&self, method: String, input: Value) -> Result<Value, String> {
        let id = self.inner.next_job_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.inner
            .jobs
            .lock()
            .map_err(|_| "Cloud job state is unavailable.".to_owned())?
            .insert(id, NativeJob::default());
        let engine = self.clone();
        thread::spawn(move || {
            let result = engine.dispatch(&method, &input);
            if let Ok(mut jobs) = engine.inner.jobs.lock() {
                if let Some(job) = jobs.get_mut(&id) {
                    if job.finished {
                        return;
                    }
                    job.finished = true;
                    job.success = result.is_ok();
                    match result {
                        Ok(output) => job.output = Some(output),
                        Err(error) => job.error = Some(error),
                    }
                }
            }
        });
        Ok(json!({"jobid": id}))
    }

    fn dispatch(&self, method: &str, input: &Value) -> Result<Value, String> {
        match method {
            "config/setpath" => Ok(json!({"ok": true})),
            "config/paths" => Ok(json!({"config": self.inner.config_path})),
            "config/dump" => self.config_dump(),
            "config/get" => self.config_get(string(input, "name")?),
            "config/create" | "config/update" => self.config_save(method, input),
            "config/delete" => self.config_delete(string(input, "name")?),
            "config/providers" => Ok(provider_catalog()),
            "misty/authorization-reset" => Ok(json!({"ok": true})),
            "misty/authorization-url" => Ok(json!({"url": ""})),
            "misty/config-security" => Ok(json!({
                "encrypted": true,
                "unlocked": true,
                "password_present": true,
                "message": "Cloud credentials are held by Misty OAuth sessions."
            })),
            "misty/config-harden" => Ok(json!({
                "encrypted": true,
                "unlocked": true,
                "password_present": true,
                "message": "Cloud credentials are encrypted."
            })),
            "misty/clear-session-tokens" => self.clear_session_tokens(),
            "job/status" => self.job_status(integer(input, "jobid")?),
            "job/stop" => self.job_stop(integer(input, "jobid")?),
            "operations/list" => {
                let (client, path) =
                    self.client_for_fs(string(input, "fs")?, optional_string(input, "remote"))?;
                Ok(json!({"list": client.list(&path)?}))
            }
            "operations/stat" => {
                let (client, path) =
                    self.client_for_fs(string(input, "fs")?, optional_string(input, "remote"))?;
                Ok(json!({"item": client.stat(&path)?}))
            }
            "operations/about" => {
                let (client, _) = self.client_for_fs(string(input, "fs")?, None)?;
                client.about()
            }
            "operations/size" => {
                let (client, path) = self.client_for_fs(string(input, "fs")?, None)?;
                let (bytes, count) = tree_size(&client, &path)?;
                Ok(json!({"bytes": bytes, "count": count}))
            }
            "operations/mkdir" => {
                let (client, path) =
                    self.client_for_fs(string(input, "fs")?, optional_string(input, "remote"))?;
                client.mkdir(&path)?;
                Ok(json!({"ok": true}))
            }
            "operations/deletefile" | "operations/purge" => {
                let (client, path) =
                    self.client_for_fs(string(input, "fs")?, optional_string(input, "remote"))?;
                client.delete(&path)?;
                Ok(json!({"ok": true}))
            }
            "operations/copyfile" | "operations/movefile" => {
                self.copy_file(input, method == "operations/movefile")
            }
            "sync/copy" | "sync/move" => self.copy_tree(input, method == "sync/move"),
            "operations/check" => self.check_trees(input),
            _ => Err(format!(
                "Native storage method {method:?} is not supported."
            )),
        }
    }

    fn config_dump(&self) -> Result<Value, String> {
        let remotes = self
            .inner
            .remotes
            .read()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        serde_json::to_value(&*remotes).map_err(|error| error.to_string())
    }

    fn config_get(&self, name: &str) -> Result<Value, String> {
        let remotes = self
            .inner
            .remotes
            .read()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        remotes
            .get(name.trim_end_matches(':'))
            .cloned()
            .map(Value::Object)
            .ok_or_else(|| "Cloud connection was not found.".to_owned())
    }

    fn config_save(&self, method: &str, input: &Value) -> Result<Value, String> {
        let name = string(input, "name")?.trim();
        if name.is_empty() {
            return Err("Cloud connection name is required.".to_owned());
        }
        let mut remotes = self
            .inner
            .remotes
            .write()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        let config = remotes.entry(name.to_owned()).or_default();
        if method == "config/create" || input.get("type").and_then(Value::as_str).is_some() {
            config.insert(
                "type".to_owned(),
                Value::String(string(input, "type")?.to_owned()),
            );
        }
        if let Some(parameters) = input.get("parameters").and_then(Value::as_object) {
            config.extend(parameters.clone());
        }
        if access_token(config).is_none() {
            return Err(
                "Authorize this connection with your Misty account before importing it.".to_owned(),
            );
        }
        persist_connections(&self.inner.config_path, &remotes)?;
        Ok(json!({"ok": true}))
    }

    fn config_delete(&self, name: &str) -> Result<Value, String> {
        let mut remotes = self
            .inner
            .remotes
            .write()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        remotes.remove(name.trim_end_matches(':'));
        persist_connections(&self.inner.config_path, &remotes)?;
        Ok(json!({"ok": true}))
    }

    fn clear_session_tokens(&self) -> Result<Value, String> {
        let mut remotes = self
            .inner
            .remotes
            .write()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        for config in remotes.values_mut() {
            config.remove("access_token");
            config.remove("token");
        }
        Ok(json!({"ok": true}))
    }

    fn job_status(&self, id: i64) -> Result<Value, String> {
        let jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Cloud job state is unavailable.".to_owned())?;
        serde_json::to_value(
            jobs.get(&id)
                .ok_or_else(|| "Cloud job was not found.".to_owned())?,
        )
        .map_err(|error| error.to_string())
    }

    fn job_stop(&self, id: i64) -> Result<Value, String> {
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Cloud job state is unavailable.".to_owned())?;
        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| "Cloud job was not found.".to_owned())?;
        if !job.finished {
            job.finished = true;
            job.success = false;
            job.error = Some("canceled".to_owned());
        }
        Ok(json!({"ok": true}))
    }

    fn client_for_fs(
        &self,
        fs: &str,
        extra_path: Option<&str>,
    ) -> Result<(CloudClient, String), String> {
        let (name, base) = split_fs(fs);
        let remotes = self
            .inner
            .remotes
            .read()
            .map_err(|_| "Cloud connection state is unavailable.".to_owned())?;
        let config = remotes
            .get(name)
            .ok_or_else(|| format!("Cloud connection {name:?} was not found."))?;
        let provider = config
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let token = access_token(config)
            .ok_or_else(|| format!("{name} requires authorization through Misty."))?;
        Ok((
            CloudClient {
                provider: provider.to_owned(),
                token,
                http: self.inner.client.clone(),
            },
            join_cloud_path([base, extra_path.unwrap_or_default()]),
        ))
    }

    fn configured_remote_name(&self, fs: &str) -> Option<String> {
        if is_windows_absolute_path(fs) {
            return None;
        }
        let (name, _) = split_fs(fs);
        self.inner
            .remotes
            .read()
            .ok()
            .filter(|remotes| remotes.contains_key(name))
            .map(|_| name.to_owned())
    }

    fn copy_file(&self, input: &Value, moving: bool) -> Result<Value, String> {
        let src_fs = string(input, "srcFs")?;
        let dst_fs = string(input, "dstFs")?;
        let src_remote = optional_string(input, "srcRemote").unwrap_or_default();
        let dst_remote = optional_string(input, "dstRemote").unwrap_or_default();
        let src_name = self.configured_remote_name(src_fs);
        let dst_name = self.configured_remote_name(dst_fs);
        match (src_name.as_deref(), dst_name.as_deref()) {
            (None, Some(_)) => {
                let (destination, path) = self.client_for_fs(dst_fs, Some(dst_remote))?;
                let source = Path::new(src_fs).join(Path::new(src_remote));
                destination.write_file(&path, &source)?;
                if moving {
                    fs::remove_file(source).map_err(|error| error.to_string())?;
                }
            }
            (Some(_), None) => {
                let (source, path) = self.client_for_fs(src_fs, Some(src_remote))?;
                let destination = Path::new(dst_fs).join(Path::new(dst_remote));
                source.download_file(&path, &destination)?;
                if moving {
                    source.delete(&path)?;
                }
            }
            (Some(source_name), Some(destination_name)) => {
                let (source, source_path) = self.client_for_fs(src_fs, Some(src_remote))?;
                let (destination, destination_path) =
                    self.client_for_fs(dst_fs, Some(dst_remote))?;
                if moving && source_name == destination_name {
                    source.move_item(&source_path, &destination_path)?;
                } else {
                    let response = source.read(&source_path)?;
                    destination.write_reader(&destination_path, response)?;
                    if moving {
                        source.delete(&source_path)?;
                    }
                }
            }
            (None, None) => {
                return Err("At least one copy endpoint must be a cloud connection.".to_owned())
            }
        }
        Ok(json!({"ok": true}))
    }

    fn copy_tree(&self, input: &Value, moving: bool) -> Result<Value, String> {
        if let Some(root) = local_root(input.get("srcFs")) {
            let (destination, destination_path) =
                self.client_for_fs(string(input, "dstFs")?, None)?;
            upload_local_tree(Path::new(root), &destination, &destination_path)?;
            if moving {
                return Err("Moving a local folder into cloud storage is not supported.".to_owned());
            }
            return Ok(json!({"ok": true}));
        }
        let src_fs = string(input, "srcFs")?;
        let dst_fs = string(input, "dstFs")?;
        if self.configured_remote_name(dst_fs).is_none() {
            let (source, source_path) = self.client_for_fs(src_fs, None)?;
            download_cloud_tree(&source, &source_path, Path::new(dst_fs))?;
            if moving {
                source.delete(&source_path)?;
            }
            return Ok(json!({"ok": true}));
        }
        let (source, source_path) = self.client_for_fs(src_fs, None)?;
        let (destination, destination_path) = self.client_for_fs(dst_fs, None)?;
        copy_cloud_tree(&source, &source_path, &destination, &destination_path)?;
        if moving {
            source.delete(&source_path)?;
        }
        Ok(json!({"ok": true}))
    }

    fn check_trees(&self, input: &Value) -> Result<Value, String> {
        let (source_bytes, source_count) = self.endpoint_tree_size(string(input, "srcFs")?)?;
        let (destination_bytes, destination_count) =
            self.endpoint_tree_size(string(input, "dstFs")?)?;
        Ok(json!({
            "success": source_bytes == destination_bytes && source_count == destination_count,
            "source_bytes": source_bytes,
            "destination_bytes": destination_bytes,
            "source_count": source_count,
            "destination_count": destination_count
        }))
    }

    fn endpoint_tree_size(&self, endpoint: &str) -> Result<(i64, i64), String> {
        if self.configured_remote_name(endpoint).is_some() {
            let (client, path) = self.client_for_fs(endpoint, None)?;
            tree_size(&client, &path)
        } else {
            local_tree_size(Path::new(endpoint))
        }
    }
}

#[derive(Clone)]
struct CloudClient {
    provider: String,
    token: String,
    http: Client,
}

impl CloudClient {
    fn request(&self, method: Method, endpoint: &str) -> RequestBuilder {
        self.http.request(method, endpoint).bearer_auth(&self.token)
    }

    fn send(&self, request: RequestBuilder) -> Result<Response, String> {
        checked_response(
            request.send().map_err(|error| error.to_string())?,
            &self.provider,
        )
    }

    fn list(&self, path: &str) -> Result<Vec<Value>, String> {
        match self.provider.as_str() {
            "dropbox" => self.dropbox_list(path),
            "onedrive" => self.onedrive_list(path),
            "drive" => self.drive_list(path),
            provider => Err(format!("Unsupported cloud provider {provider:?}.")),
        }
    }

    fn stat(&self, path: &str) -> Result<Value, String> {
        if clean_cloud_path(path).is_empty() {
            return Ok(cloud_item("", "", 0, "", "", true, ""));
        }
        let (parent, name) = split_parent(path);
        self.list(&parent)?
            .into_iter()
            .find(|item| {
                item.get("Name")
                    .and_then(Value::as_str)
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&name))
            })
            .ok_or_else(|| format!("Cloud item {path:?} was not found."))
    }

    fn about(&self) -> Result<Value, String> {
        match self.provider.as_str() {
            "dropbox" => {
                let value: Value = self
                    .send(
                        self.request(
                            Method::POST,
                            "https://api.dropboxapi.com/2/users/get_space_usage",
                        )
                        .header(CONTENT_TYPE, "application/json")
                        .body("null"),
                    )?
                    .json()
                    .map_err(|error| error.to_string())?;
                let used = value.get("used").and_then(Value::as_i64).unwrap_or(0);
                let total = value
                    .pointer("/allocation/allocated")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                Ok(json!({"total": total, "used": used, "free": total - used}))
            }
            "onedrive" => {
                let value: Value = self
                    .send(self.request(
                        Method::GET,
                        "https://graph.microsoft.com/v1.0/me/drive?$select=quota",
                    ))?
                    .json()
                    .map_err(|error| error.to_string())?;
                Ok(json!({
                    "total": value.pointer("/quota/total").and_then(Value::as_i64).unwrap_or(0),
                    "used": value.pointer("/quota/used").and_then(Value::as_i64).unwrap_or(0),
                    "free": value.pointer("/quota/remaining").and_then(Value::as_i64).unwrap_or(0)
                }))
            }
            "drive" => {
                let value: Value = self
                    .send(self.request(
                        Method::GET,
                        "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
                    ))?
                    .json()
                    .map_err(|error| error.to_string())?;
                let total = json_i64(value.pointer("/storageQuota/limit"));
                let used = json_i64(value.pointer("/storageQuota/usage"));
                Ok(json!({"total": total, "used": used, "free": total - used}))
            }
            _ => Err("Unsupported cloud provider.".to_owned()),
        }
    }

    fn mkdir(&self, path: &str) -> Result<(), String> {
        let (parent, name) = split_parent(path);
        let response = match self.provider.as_str() {
            "dropbox" => self.send(
                self.request(
                    Method::POST,
                    "https://api.dropboxapi.com/2/files/create_folder_v2",
                )
                .json(&json!({"path": dropbox_path(path), "autorename": false})),
            )?,
            "onedrive" => self.send(
                self.request(Method::POST, &onedrive_children_url(&parent))
                    .json(&json!({"name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"})),
            )?,
            "drive" => {
                let parent_id = self.drive_folder_id(&parent)?;
                self.send(
                    self.request(Method::POST, "https://www.googleapis.com/drive/v3/files")
                        .json(&json!({"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]})),
                )?
            }
            _ => return Err("Unsupported cloud provider.".to_owned()),
        };
        drop(response);
        Ok(())
    }

    fn delete(&self, path: &str) -> Result<(), String> {
        let response = match self.provider.as_str() {
            "dropbox" => self.send(
                self.request(Method::POST, "https://api.dropboxapi.com/2/files/delete_v2")
                    .json(&json!({"path": dropbox_path(path)})),
            )?,
            "onedrive" => self.send(self.request(Method::DELETE, &onedrive_item_url(path)))?,
            "drive" => {
                let id = self.drive_item_id(path)?;
                self.send(self.request(
                    Method::DELETE,
                    &format!(
                        "https://www.googleapis.com/drive/v3/files/{}",
                        encode_segment(&id)
                    ),
                ))?
            }
            _ => return Err("Unsupported cloud provider.".to_owned()),
        };
        drop(response);
        Ok(())
    }

    fn read(&self, path: &str) -> Result<Response, String> {
        match self.provider.as_str() {
            "dropbox" => self.send(
                self.request(
                    Method::POST,
                    "https://content.dropboxapi.com/2/files/download",
                )
                .header(
                    "Dropbox-API-Arg",
                    json!({"path": dropbox_path(path)}).to_string(),
                ),
            ),
            "onedrive" => self.send(self.request(
                Method::GET,
                &format!("{}:/content", onedrive_item_url(path)),
            )),
            "drive" => {
                let id = self.drive_item_id(path)?;
                self.send(self.request(
                    Method::GET,
                    &format!(
                        "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                        encode_segment(&id)
                    ),
                ))
            }
            _ => Err("Unsupported cloud provider.".to_owned()),
        }
    }

    fn download_file(&self, path: &str, destination: &Path) -> Result<(), String> {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut response = self.read(path)?;
        let temporary = destination.with_extension(format!("misty-{}", Uuid::new_v4()));
        let mut output = File::create(&temporary).map_err(|error| error.to_string())?;
        io::copy(&mut response, &mut output).map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, destination).map_err(|error| error.to_string())
    }

    fn write_file(&self, path: &str, source: &Path) -> Result<(), String> {
        let file = File::open(source).map_err(|error| error.to_string())?;
        self.write_reader(path, file)
    }

    fn write_reader(&self, path: &str, mut reader: impl Read) -> Result<(), String> {
        let (mut file, size, temporary) = spool_reader(&mut reader)?;
        let result = match self.provider.as_str() {
            "dropbox" => self.dropbox_write(path, &mut file, size),
            "onedrive" => self.onedrive_write(path, &mut file, size),
            "drive" => self.drive_write(path, &mut file, size),
            _ => Err("Unsupported cloud provider.".to_owned()),
        };
        drop(file);
        let _ = fs::remove_file(temporary);
        result
    }

    fn move_item(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        let response = match self.provider.as_str() {
            "dropbox" => self.send(
                self.request(Method::POST, "https://api.dropboxapi.com/2/files/move_v2")
                    .json(&json!({
                        "from_path": dropbox_path(old_path),
                        "to_path": dropbox_path(new_path),
                        "autorename": false
                    })),
            )?,
            "onedrive" => {
                let (parent, name) = split_parent(new_path);
                self.send(
                    self.request(Method::PATCH, &onedrive_item_url(old_path))
                        .json(&json!({"name": name, "parentReference": {"path": format!("/drive/root:/{}", clean_cloud_path(&parent))}})),
                )?
            }
            "drive" => {
                let id = self.drive_item_id(old_path)?;
                let old_parent = self.drive_folder_id(&split_parent(old_path).0)?;
                let (new_parent_path, name) = split_parent(new_path);
                let new_parent = self.drive_folder_id(&new_parent_path)?;
                let mut url = Url::parse(&format!(
                    "https://www.googleapis.com/drive/v3/files/{}",
                    encode_segment(&id)
                ))
                .map_err(|error| error.to_string())?;
                url.query_pairs_mut()
                    .append_pair("addParents", &new_parent)
                    .append_pair("removeParents", &old_parent)
                    .append_pair("fields", "id");
                self.send(
                    self.request(Method::PATCH, url.as_str())
                        .json(&json!({"name": name})),
                )?
            }
            _ => return Err("Unsupported cloud provider.".to_owned()),
        };
        drop(response);
        Ok(())
    }

    fn dropbox_list(&self, path: &str) -> Result<Vec<Value>, String> {
        let mut endpoint = "https://api.dropboxapi.com/2/files/list_folder".to_owned();
        let mut body =
            json!({"path": dropbox_path(path), "recursive": false, "include_deleted": false});
        let mut items = Vec::new();
        loop {
            let value: Value = self
                .send(self.request(Method::POST, &endpoint).json(&body))?
                .json()
                .map_err(|error| error.to_string())?;
            for entry in value
                .get("entries")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                items.push(cloud_item(
                    entry
                        .get("path_display")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim_start_matches('/'),
                    name,
                    entry.get("size").and_then(Value::as_i64).unwrap_or(0),
                    "",
                    entry
                        .get("server_modified")
                        .or_else(|| entry.get("client_modified"))
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    entry.get(".tag").and_then(Value::as_str) == Some("folder"),
                    entry.get("id").and_then(Value::as_str).unwrap_or_default(),
                ));
            }
            if !value
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Ok(items);
            }
            endpoint = "https://api.dropboxapi.com/2/files/list_folder/continue".to_owned();
            body =
                json!({"cursor": value.get("cursor").and_then(Value::as_str).unwrap_or_default()});
        }
    }

    fn onedrive_list(&self, path: &str) -> Result<Vec<Value>, String> {
        let mut endpoint = format!(
            "{}?$select=id,name,size,lastModifiedDateTime,file,folder",
            onedrive_children_url(path)
        );
        let mut items = Vec::new();
        while !endpoint.is_empty() {
            let value: Value = self
                .send(self.request(Method::GET, &endpoint))?
                .json()
                .map_err(|error| error.to_string())?;
            for entry in value
                .get("value")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                items.push(cloud_item(
                    &join_cloud_path([path, name]),
                    name,
                    entry.get("size").and_then(Value::as_i64).unwrap_or(0),
                    entry
                        .pointer("/file/mimeType")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    entry
                        .get("lastModifiedDateTime")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    entry.get("folder").is_some(),
                    entry.get("id").and_then(Value::as_str).unwrap_or_default(),
                ));
            }
            endpoint = value
                .get("@odata.nextLink")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
        }
        Ok(items)
    }

    fn drive_list(&self, path: &str) -> Result<Vec<Value>, String> {
        let parent_id = self.drive_folder_id(path)?;
        let mut page_token = String::new();
        let mut items = Vec::new();
        loop {
            let mut url = Url::parse("https://www.googleapis.com/drive/v3/files")
                .map_err(|error| error.to_string())?;
            {
                let mut query = url.query_pairs_mut();
                query
                    .append_pair("q", &format!("'{parent_id}' in parents and trashed=false"))
                    .append_pair(
                        "fields",
                        "nextPageToken,files(id,name,size,mimeType,modifiedTime)",
                    )
                    .append_pair("pageSize", "1000");
                if !page_token.is_empty() {
                    query.append_pair("pageToken", &page_token);
                }
            }
            let value: Value = self
                .send(self.request(Method::GET, url.as_str()))?
                .json()
                .map_err(|error| error.to_string())?;
            for entry in value
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mime = entry
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                items.push(cloud_item(
                    &join_cloud_path([path, name]),
                    name,
                    json_i64(entry.get("size")),
                    mime,
                    entry
                        .get("modifiedTime")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    mime == "application/vnd.google-apps.folder",
                    entry.get("id").and_then(Value::as_str).unwrap_or_default(),
                ));
            }
            page_token = value
                .get("nextPageToken")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if page_token.is_empty() {
                return Ok(items);
            }
        }
    }

    fn drive_folder_id(&self, path: &str) -> Result<String, String> {
        let mut id = "root".to_owned();
        for component in split_cloud_path(path) {
            let mut url = Url::parse("https://www.googleapis.com/drive/v3/files")
                .map_err(|error| error.to_string())?;
            url.query_pairs_mut()
                .append_pair(
                    "q",
                    &format!(
                        "'{id}' in parents and name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                        google_query_string(&component)
                    ),
                )
                .append_pair("fields", "files(id)")
                .append_pair("pageSize", "1");
            let value: Value = self
                .send(self.request(Method::GET, url.as_str()))?
                .json()
                .map_err(|error| error.to_string())?;
            id = value
                .pointer("/files/0/id")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Google Drive folder {component:?} was not found."))?
                .to_owned();
        }
        Ok(id)
    }

    fn drive_item_id(&self, path: &str) -> Result<String, String> {
        let (parent, name) = split_parent(path);
        let parent_id = self.drive_folder_id(&parent)?;
        let mut url = Url::parse("https://www.googleapis.com/drive/v3/files")
            .map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair(
                "q",
                &format!(
                    "'{parent_id}' in parents and name='{}' and trashed=false",
                    google_query_string(&name)
                ),
            )
            .append_pair("fields", "files(id)")
            .append_pair("pageSize", "1");
        let value: Value = self
            .send(self.request(Method::GET, url.as_str()))?
            .json()
            .map_err(|error| error.to_string())?;
        value
            .pointer("/files/0/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| format!("Google Drive item {path:?} was not found."))
    }

    fn dropbox_write(&self, path: &str, file: &mut File, size: u64) -> Result<(), String> {
        const CHUNK: u64 = 8 << 20;
        if size <= 150 << 20 {
            file.seek(SeekFrom::Start(0))
                .map_err(|error| error.to_string())?;
            let body = Body::sized(file.try_clone().map_err(|error| error.to_string())?, size);
            drop(self.send(
                self.request(
                    Method::POST,
                    "https://content.dropboxapi.com/2/files/upload",
                )
                .header(CONTENT_TYPE, "application/octet-stream")
                .header(
                    "Dropbox-API-Arg",
                    json!({"path": dropbox_path(path), "mode": "overwrite", "autorename": false, "mute": false}).to_string(),
                )
                .body(body),
            )?);
            return Ok(());
        }
        let first = CHUNK.min(size);
        let session = self.dropbox_upload_chunk(
            "https://content.dropboxapi.com/2/files/upload_session/start",
            file,
            0,
            first,
            json!({"close": false}),
        )?;
        let session_id = session
            .get("session_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Dropbox upload session did not start.".to_owned())?
            .to_owned();
        let mut offset = first;
        while offset < size {
            let length = CHUNK.min(size - offset);
            let final_chunk = offset + length == size;
            let endpoint = if final_chunk {
                "https://content.dropboxapi.com/2/files/upload_session/finish"
            } else {
                "https://content.dropboxapi.com/2/files/upload_session/append_v2"
            };
            let cursor = json!({"session_id": session_id, "offset": offset});
            let argument = if final_chunk {
                json!({"cursor": cursor, "commit": {"path": dropbox_path(path), "mode": "overwrite", "autorename": false, "mute": false}})
            } else {
                json!({"cursor": cursor, "close": false})
            };
            self.dropbox_upload_chunk(endpoint, file, offset, length, argument)?;
            offset += length;
        }
        Ok(())
    }

    fn dropbox_upload_chunk(
        &self,
        endpoint: &str,
        file: &mut File,
        offset: u64,
        length: u64,
        argument: Value,
    ) -> Result<Value, String> {
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let body = Body::sized(
            file.try_clone()
                .map_err(|error| error.to_string())?
                .take(length),
            length,
        );
        let response = self.send(
            self.request(Method::POST, endpoint)
                .header(CONTENT_TYPE, "application/octet-stream")
                .header("Dropbox-API-Arg", argument.to_string())
                .body(body),
        )?;
        response
            .json()
            .or_else(|error| {
                if endpoint.ends_with("append_v2") {
                    Ok(json!({}))
                } else {
                    Err(error)
                }
            })
            .map_err(|error| error.to_string())
    }

    fn onedrive_write(&self, path: &str, file: &mut File, size: u64) -> Result<(), String> {
        if size <= 250 << 20 {
            file.seek(SeekFrom::Start(0))
                .map_err(|error| error.to_string())?;
            drop(
                self.send(
                    self.request(
                        Method::PUT,
                        &format!("{}:/content", onedrive_item_url(path)),
                    )
                    .header(CONTENT_TYPE, "application/octet-stream")
                    .header(CONTENT_LENGTH, size)
                    .body(Body::sized(
                        file.try_clone().map_err(|error| error.to_string())?,
                        size,
                    )),
                )?,
            );
            return Ok(());
        }
        let session: Value = self
            .send(
                self.request(
                    Method::POST,
                    &format!("{}:/createUploadSession", onedrive_item_url(path)),
                )
                .json(&json!({"item": {"@microsoft.graph.conflictBehavior": "replace"}})),
            )?
            .json()
            .map_err(|error| error.to_string())?;
        let upload_url = session
            .get("uploadUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| "OneDrive upload session did not start.".to_owned())?;
        const CHUNK: u64 = 10 << 20;
        let mut offset = 0;
        while offset < size {
            let length = CHUNK.min(size - offset);
            file.seek(SeekFrom::Start(offset))
                .map_err(|error| error.to_string())?;
            let response = self
                .http
                .put(upload_url)
                .header(CONTENT_TYPE, "application/octet-stream")
                .header(CONTENT_LENGTH, length)
                .header(
                    CONTENT_RANGE,
                    format!("bytes {}-{}/{}", offset, offset + length - 1, size),
                )
                .body(Body::sized(
                    file.try_clone()
                        .map_err(|error| error.to_string())?
                        .take(length),
                    length,
                ))
                .send()
                .map_err(|error| error.to_string())?;
            drop(checked_response(response, "onedrive")?);
            offset += length;
        }
        Ok(())
    }

    fn drive_write(&self, path: &str, file: &mut File, size: u64) -> Result<(), String> {
        let (parent, name) = split_parent(path);
        let parent_id = self.drive_folder_id(&parent)?;
        let mut method = Method::POST;
        let mut endpoint =
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable".to_owned();
        let mut metadata = json!({"name": name, "parents": [parent_id]});
        if let Ok(id) = self.drive_item_id(path) {
            method = Method::PATCH;
            endpoint = format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=resumable",
                encode_segment(&id)
            );
            metadata = json!({"name": name});
        }
        let response = self.send(
            self.request(method, &endpoint)
                .header("X-Upload-Content-Type", "application/octet-stream")
                .header("X-Upload-Content-Length", size)
                .json(&metadata),
        )?;
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "Google Drive upload session did not start.".to_owned())?
            .to_owned();
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        drop(
            self.send(
                self.request(Method::PUT, &location)
                    .header(CONTENT_TYPE, "application/octet-stream")
                    .header(CONTENT_LENGTH, size)
                    .body(Body::sized(
                        file.try_clone().map_err(|error| error.to_string())?,
                        size,
                    )),
            )?,
        );
        Ok(())
    }
}

fn checked_response(response: Response, provider: &str) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let message = response.text().unwrap_or_default();
    Err(format!("{provider} returned {status}: {}", message.trim()))
}

fn read_connections(path: &Path) -> Result<HashMap<String, RemoteConfig>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error.to_string()),
    };
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(HashMap::new());
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "Cloud connection metadata {} is invalid: {error}",
            path.display()
        )
    })
}

fn persist_connections(path: &Path, remotes: &HashMap<String, RemoteConfig>) -> Result<(), String> {
    let mut persisted = remotes.clone();
    for config in persisted.values_mut() {
        config.remove("access_token");
        config.remove("token");
    }
    let temporary = path.with_extension("json.tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(&persisted).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    drop(file);
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn provider_catalog() -> Value {
    let options = json!([
        {"Name": "client_id", "Help": "Optional custom OAuth client ID."},
        {"Name": "client_secret", "Help": "Optional custom OAuth client secret.", "IsPassword": true}
    ]);
    json!({"providers": [
        {"Prefix": "drive", "Description": "Google Drive", "Options": options},
        {"Prefix": "dropbox", "Description": "Dropbox", "Options": options},
        {"Prefix": "onedrive", "Description": "Microsoft OneDrive", "Options": options}
    ]})
}

fn access_token(config: &RemoteConfig) -> Option<String> {
    for key in ["access_token", "token"] {
        let Some(value) = config.get(key).and_then(Value::as_str) else {
            continue;
        };
        if key == "token" && value.trim_start().starts_with('{') {
            if let Ok(envelope) = serde_json::from_str::<Value>(value) {
                if let Some(token) = envelope.get("access_token").and_then(Value::as_str) {
                    if !token.trim().is_empty() {
                        return Some(token.to_owned());
                    }
                }
            }
        } else if !value.trim().is_empty() {
            return Some(value.to_owned());
        }
    }
    None
}

fn string<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Storage field {key:?} is required."))
}

fn optional_string<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input.get(key).and_then(Value::as_str)
}

fn integer(input: &Value, key: &str) -> Result<i64, String> {
    input
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("Storage field {key:?} is required."))
}

fn local_root(value: Option<&Value>) -> Option<&str> {
    let value = value?.as_object()?;
    (value.get("type").and_then(Value::as_str) == Some("local"))
        .then(|| value.get("_root").and_then(Value::as_str))
        .flatten()
}

fn clean_cloud_path(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_owned()
}

fn split_cloud_path(path: &str) -> Vec<String> {
    clean_cloud_path(path)
        .split('/')
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn join_cloud_path<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    parts
        .into_iter()
        .map(clean_cloud_path)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn split_parent(path: &str) -> (String, String) {
    let clean = clean_cloud_path(path);
    clean
        .rsplit_once('/')
        .map(|(parent, name)| (parent.to_owned(), name.to_owned()))
        .unwrap_or_else(|| (String::new(), clean))
}

fn split_fs(value: &str) -> (&str, &str) {
    value
        .split_once(':')
        .map(|(name, path)| (name.trim(), path.trim_matches('/')))
        .unwrap_or(("", value))
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn dropbox_path(path: &str) -> String {
    let clean = clean_cloud_path(path);
    if clean.is_empty() {
        String::new()
    } else {
        format!("/{clean}")
    }
}

fn encode_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn onedrive_item_url(path: &str) -> String {
    let clean = clean_cloud_path(path);
    if clean.is_empty() {
        return "https://graph.microsoft.com/v1.0/me/drive/root".to_owned();
    }
    let encoded = split_cloud_path(&clean)
        .into_iter()
        .map(|part| encode_segment(&part))
        .collect::<Vec<_>>()
        .join("/");
    format!("https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}")
}

fn onedrive_children_url(path: &str) -> String {
    format!("{}:/children", onedrive_item_url(path))
}

fn google_query_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn json_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or(0)
}

fn cloud_item(
    path: &str,
    name: &str,
    size: i64,
    mime_type: &str,
    modified: &str,
    is_dir: bool,
    id: &str,
) -> Value {
    json!({
        "Path": path,
        "Name": name,
        "Size": size,
        "MimeType": mime_type,
        "ModTime": modified,
        "IsDir": is_dir,
        "ID": id
    })
}

fn spool_reader(reader: &mut impl Read) -> Result<(File, u64, PathBuf), String> {
    let path = std::env::temp_dir().join(format!("misty-cloud-upload-{}", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let size = io::copy(reader, &mut file).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok((file, size, path))
}

fn copy_cloud_tree(
    source: &CloudClient,
    source_path: &str,
    destination: &CloudClient,
    destination_path: &str,
) -> Result<(), String> {
    if !clean_cloud_path(destination_path).is_empty() {
        let _ = destination.mkdir(destination_path);
    }
    for item in source.list(source_path)? {
        let item_path = item.get("Path").and_then(Value::as_str).unwrap_or_default();
        let name = item.get("Name").and_then(Value::as_str).unwrap_or_default();
        let target = join_cloud_path([destination_path, name]);
        if item.get("IsDir").and_then(Value::as_bool).unwrap_or(false) {
            copy_cloud_tree(source, item_path, destination, &target)?;
        } else {
            destination.write_reader(&target, source.read(item_path)?)?;
        }
    }
    Ok(())
}

fn upload_local_tree(
    root: &Path,
    destination: &CloudClient,
    destination_path: &str,
) -> Result<(), String> {
    if !root.is_dir() {
        return Err("Local upload source must be a folder.".to_owned());
    }
    if !clean_cloud_path(destination_path).is_empty() {
        let _ = destination.mkdir(destination_path);
    }
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path() == root {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| error.to_string())?;
        let remote_path = join_cloud_path([
            destination_path,
            &relative.to_string_lossy().replace('\\', "/"),
        ]);
        if entry.file_type().is_dir() {
            let _ = destination.mkdir(&remote_path);
        } else if entry.file_type().is_file() {
            destination.write_file(&remote_path, entry.path())?;
        }
    }
    Ok(())
}

fn download_cloud_tree(
    source: &CloudClient,
    source_path: &str,
    destination: &Path,
) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for item in source.list(source_path)? {
        let item_path = item.get("Path").and_then(Value::as_str).unwrap_or_default();
        let name = item.get("Name").and_then(Value::as_str).unwrap_or_default();
        let target = destination.join(name);
        if item.get("IsDir").and_then(Value::as_bool).unwrap_or(false) {
            download_cloud_tree(source, item_path, &target)?;
        } else {
            source.download_file(item_path, &target)?;
        }
    }
    Ok(())
}

fn tree_size(client: &CloudClient, path: &str) -> Result<(i64, i64), String> {
    if let Ok(item) = client.stat(path) {
        if !item.get("IsDir").and_then(Value::as_bool).unwrap_or(false) {
            return Ok((item.get("Size").and_then(Value::as_i64).unwrap_or(0), 1));
        }
    }
    let mut bytes = 0;
    let mut count = 0;
    for item in client.list(path)? {
        if item.get("IsDir").and_then(Value::as_bool).unwrap_or(false) {
            let (child_bytes, child_count) = tree_size(
                client,
                item.get("Path").and_then(Value::as_str).unwrap_or_default(),
            )?;
            bytes += child_bytes;
            count += child_count;
        } else {
            bytes += item.get("Size").and_then(Value::as_i64).unwrap_or(0);
            count += 1;
        }
    }
    Ok((bytes, count))
}

fn local_tree_size(path: &Path) -> Result<(i64, i64), String> {
    let mut bytes = 0;
    let mut count = 0;
    for entry in walkdir::WalkDir::new(path) {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_file() {
            bytes += entry.metadata().map_err(|error| error.to_string())?.len() as i64;
            count += 1;
        }
    }
    Ok((bytes, count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onedrive_paths_escape_each_segment() {
        assert_eq!(
            onedrive_item_url("Reports & Plans/Q3 #1.txt"),
            "https://graph.microsoft.com/v1.0/me/drive/root:/Reports%20%26%20Plans/Q3%20%231%2Etxt"
        );
    }

    #[test]
    fn windows_paths_are_not_remote_names() {
        assert!(is_windows_absolute_path(r"C:\Users\Misty\Backup"));
    }

    #[test]
    fn persisted_connections_exclude_session_tokens() {
        let root = std::env::temp_dir().join(format!("misty-cloud-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("connections.json");
        let mut config = RemoteConfig::new();
        config.insert("type".to_owned(), Value::String("drive".to_owned()));
        config.insert(
            "access_token".to_owned(),
            Value::String("temporary".to_owned()),
        );
        config.insert(
            "misty_connection_id".to_owned(),
            Value::String("cloud_123".to_owned()),
        );
        persist_connections(&path, &HashMap::from([("work".to_owned(), config)])).unwrap();
        let persisted = read_connections(&path).unwrap();
        assert!(persisted["work"].get("access_token").is_none());
        assert_eq!(
            persisted["work"]["misty_connection_id"],
            Value::String("cloud_123".to_owned())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn token_envelope_is_read_when_access_token_is_absent() {
        let config = json!({
            "type": "drive",
            "token": "{\"access_token\":\"leased-token\"}"
        })
        .as_object()
        .cloned()
        .expect("remote config");

        assert_eq!(access_token(&config).as_deref(), Some("leased-token"));
    }
}
