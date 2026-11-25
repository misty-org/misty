use super::app;
use crate::app::runtime::MistyRuntime;
use crate::browser::*;
use rusqlite::{params, OptionalExtension};
use serde_json::Map;

const SCOPE: &str = "browser:site-permissions";

pub(super) const CAMERA: &str = "camera";
pub(super) const MICROPHONE: &str = "microphone";
pub(super) const LOCATION: &str = "location";
const KINDS: [&str; 3] = [CAMERA, MICROPHONE, LOCATION];

pub(super) type Answer = Box<dyn FnOnce(bool) + Send>;

struct Pending {
    page: String,
    origin: String,
    kinds: Vec<&'static str>,
    answer: Answer,
}

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

fn read_all(app: &AppHandle) -> Map<String, Value> {
    let read = || -> Result<Option<String>, rusqlite::Error> {
        app.state::<MistyRuntime>()
            .environment
            .store()
            .connect()?
            .query_row(
                "SELECT document FROM settings_state WHERE scope = ?1",
                [SCOPE],
                |row| row.get(0),
            )
            .optional()
    };
    read()
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_all(app: &AppHandle, document: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string(document).map_err(|error| error.to_string())?;
    app.state::<MistyRuntime>()
        .environment
        .store()
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO settings_state(scope, revision, document) VALUES(?1, 1, ?2)
                 ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
                params![SCOPE, text],
            )
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn decided(app: &AppHandle, origin: &str, kinds: &[&'static str]) -> Option<bool> {
    let all = read_all(app);
    let choices = all.get(origin)?.as_object()?;
    let mut allowed = true;
    for kind in kinds {
        match choices.get(*kind).and_then(Value::as_bool) {
            Some(false) => return Some(false),
            Some(true) => {}
            None => allowed = false,
        }
    }
    allowed.then_some(true)
}

fn set_choice(app: &AppHandle, origin: &str, kinds: &[&str], allow: Option<bool>) -> Result<(), String> {
    let mut all = read_all(app);
    let entry = all
        .entry(origin.to_owned())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(choices) = entry.as_object_mut() {
        for kind in kinds {
            match allow {
                Some(allow) => choices.insert((*kind).to_owned(), Value::Bool(allow)),
                None => choices.remove(*kind),
            };
        }
    }
    if all
        .get(origin)
        .and_then(Value::as_object)
        .is_some_and(Map::is_empty)
    {
        all.remove(origin);
    }
    write_all(app, &all)
}

fn web_origin(origin: &str) -> Result<String, String> {
    let url = Url::parse(origin).map_err(|_| "That isn't a website.".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("That isn't a website.".to_owned());
    }
    Ok(url.origin().ascii_serialization())
}

pub(super) fn ask(page: &str, origin: String, kinds: Vec<&'static str>, answer: Answer) {
    let Some(app) = app() else {
        return answer(false);
    };
    let Ok(origin) = web_origin(&origin) else {
        return answer(false);
    };
    if let Some(known) = decided(app, &origin, &kinds) {
        return answer(known);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let body = json!({ "id": id, "page": page, "origin": origin, "kinds": kinds });
    let Ok(mut waiting) = pending().lock() else {
        return answer(false);
    };
    waiting.insert(
        id,
        Pending {
            page: page.to_owned(),
            origin,
            kinds,
            answer,
        },
    );
    drop(waiting);
    let _ = app.emit_to(
        browser_owner_label(app, page),
        "misty://browser-permission",
        body,
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSitePermissionAnswer {
    pub id: String,
    pub allow: bool,
    #[serde(default)]
    pub remember: bool,
}

#[tauri::command]
pub fn browser_site_permission_answer(
    caller: Webview,
    app: AppHandle,
    request: BrowserSitePermissionAnswer,
) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    let entry = pending()
        .lock()
        .map_err(|_| "Site permissions are unavailable.")?
        .remove(&request.id)
        .ok_or("That question was already answered.")?;
    if browser_owner_label(&app, &entry.page) != caller.window().label() {
        (entry.answer)(false);
        return Err("That tab isn't in this window.".into());
    }
    if request.remember {
        set_choice(&app, &entry.origin, &entry.kinds, Some(request.allow))?;
    }
    (entry.answer)(request.allow);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSitePermissionsRequest {
    pub origin: String,
}

#[tauri::command]
pub fn browser_site_permissions(
    caller: Webview,
    app: AppHandle,
    request: BrowserSitePermissionsRequest,
) -> Result<Map<String, Value>, String> {
    crate::project::person_window(&caller)?;
    let origin = web_origin(&request.origin)?;
    Ok(read_all(&app)
        .get(&origin)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSitePermissionSetRequest {
    pub origin: String,
    pub kind: String,
    pub allow: Option<bool>,
}

#[tauri::command]
pub fn browser_site_permission_set(
    caller: Webview,
    app: AppHandle,
    request: BrowserSitePermissionSetRequest,
) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    let origin = web_origin(&request.origin)?;
    let kind = KINDS
        .iter()
        .find(|kind| **kind == request.kind)
        .ok_or("Unknown permission.")?;
    set_choice(&app, &origin, &[*kind], request.allow)
}
