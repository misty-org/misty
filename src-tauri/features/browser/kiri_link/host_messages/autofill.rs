//! Saved addresses and cards: offering, choosing, filling and capturing, in the `autofill`
//! collection of the profile whose pages use them.
//!
//! A site learns nothing until the person picks something. The page script runs in the page's own
//! JavaScript world, so nothing it sends can be trusted as the person's choice. It only says a form
//! has focus: Misty draws the "Fill address" or "Fill card" chip (`AutofillChip`) without telling the
//! page, and only a click there opens the list (`browser_autofill_open`, `AutofillChooser`). No saved
//! detail, not even a name or the last four digits, nor whether anything is saved, is in the page's
//! reach before the choice. Cards then need Touch ID, Windows Hello or this computer's password, and
//! only ever fill on https. None of this runs in a private tab or a tab an agent is working in, so
//! agents can't reach saved details at all.
use super::passwords::{
    now_ms, page_origin, page_profile, profile_records, reply, MenuPlace, UNAVAILABLE,
};
use crate::browser::*;
use browser_data::{
    collections::AUTOFILL,
    document::{
        entities::{validate, Address, Card, Kind},
        ViewRecord,
    },
};
use std::collections::HashMap;
use zeroize::{Zeroize, Zeroizing};

mod form;
mod manage;
use form::{address_label, address_to_save, card_label, card_to_save, CapturedForm};
pub use manage::*;

/// A submitted form is at most a few short fields; anything larger isn't one.
const MAX_CAPTURE_BYTES: usize = 16 << 10;

#[derive(Clone, Copy, PartialEq, Eq)]
enum FillKind {
    Address,
    Card,
}

impl FillKind {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "address" => Some(Self::Address),
            "card" => Some(Self::Card),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Address => "address",
            Self::Card => "card",
        }
    }
}

/// The person's choices for this computer. If they can't be read, autofill stays off.
#[derive(Clone, Copy, Default)]
struct Choices {
    addresses: bool,
    cards: bool,
    offer_to_save: bool,
}

impl Choices {
    fn allows(self, kind: FillKind) -> bool {
        match kind {
            FillKind::Address => self.addresses,
            FillKind::Card => self.cards,
        }
    }
}

async fn choices(app: &AppHandle) -> Choices {
    let Some(runtime) = app.try_state::<crate::app::runtime::MistyRuntime>() else {
        return Choices::default();
    };
    let Ok(document) = runtime.settings.document().await else {
        return Choices::default();
    };
    let on = |key: &str| {
        document
            .get("autofill")
            .and_then(|section| section.get(key))
            .and_then(Value::as_bool)
            .unwrap_or(true)
    };
    Choices {
        addresses: on("addresses_enabled"),
        cards: on("cards_enabled"),
        offer_to_save: on("offer_to_save"),
    }
}

/// Pages autofill never touches: private tabs keep nothing, and a tab an agent works in must not
/// put saved details where the agent reads. Unknown pages count as both.
fn page_excluded(app: &AppHandle, id: &str) -> bool {
    app.state::<BrowserSessionState>()
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| {
            sessions.get(id).map(|session| {
                session.private
                    || session.agent_run_id.is_some()
                    || session.agent_ring
                    || session.agent_input_locked
            })
        })
        .unwrap_or(true)
}

/// Cards are only ever typed into or read from pages on an encrypted connection. A development
/// build also allows this computer's own addresses, so a local page can test them.
fn allowed_on(kind: FillKind, origin: &str) -> bool {
    kind == FillKind::Address
        || origin.starts_with("https://")
        || (cfg!(debug_assertions)
            && Url::parse(origin)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .is_some_and(|host| matches!(host.as_str(), "127.0.0.1" | "localhost")))
}

fn host_of(origin: &str) -> String {
    Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| origin.to_owned())
}

fn records_of<T: serde::de::DeserializeOwned>(
    records: &[ViewRecord],
    kind: Kind,
) -> Vec<(String, T)> {
    records
        .iter()
        .filter(|record| record.kind == kind)
        .filter_map(|record| {
            let fields = Value::Object(record.fields.clone().into_iter().collect());
            serde_json::from_value(fields)
                .ok()
                .map(|item| (record.id.clone(), item))
        })
        .collect()
}

async fn saved(profile: &str) -> Result<Vec<ViewRecord>, String> {
    profile_records(profile)?
        .records_list(AUTOFILL)
        .await
        .map_err(|_| UNAVAILABLE.to_owned())
}

async fn addresses(profile: &str) -> Result<Vec<(String, Address)>, String> {
    Ok(records_of(&saved(profile).await?, Kind::Address))
}

async fn cards(profile: &str) -> Result<Vec<(String, Card)>, String> {
    Ok(records_of(&saved(profile).await?, Kind::Card))
}

async fn write_record<T: Serialize>(
    profile: &str,
    id: String,
    kind: Kind,
    item: &T,
) -> Result<(), String> {
    let Value::Object(fields) =
        serde_json::to_value(item).map_err(|_| "This could not be saved.")?
    else {
        return Err("This could not be saved.".into());
    };
    let fields: browser_data::document::entities::Fields = fields.into_iter().collect();
    validate(kind, &fields).map_err(|_| "Check the details and try again.".to_owned())?;
    let record = ViewRecord {
        kind,
        id: id.clone(),
        fields,
    };
    profile_records(profile)?
        .records_write(AUTOFILL, vec![(id, Some(record))])
        .await
        .map_err(|_| "This could not be saved. Try again.".to_owned())
}

/// One row of the chooser. Only Misty's own interface ever sees these.
#[derive(Clone, Serialize)]
struct ChooserItem {
    id: String,
    label: String,
    detail: String,
}

/// Newest first, like Settings.
fn chooser_items(records: &[ViewRecord], kind: FillKind) -> Vec<ChooserItem> {
    match kind {
        FillKind::Address => {
            let mut list = records_of::<Address>(records, Kind::Address);
            list.sort_by_key(|(_, address)| std::cmp::Reverse(address.updated_at));
            list.into_iter()
                .map(|(id, address)| ChooserItem {
                    label: address_label(&address),
                    detail: address.name,
                    id,
                })
                .collect()
        }
        FillKind::Card => {
            let mut list = records_of::<Card>(records, Kind::Card);
            list.sort_by_key(|(_, card)| std::cmp::Reverse(card.updated_at));
            list.into_iter()
                .map(|(id, card)| ChooserItem {
                    label: card_label(&card),
                    detail: format!("{:02}/{:02}", card.exp_month, card.exp_year % 100),
                    id,
                })
                .collect()
        }
    }
}

/// A chooser open for a page: the person's pick can only fill the page that asked.
struct PendingChoice {
    page: String,
    profile: String,
    origin: String,
    kind: FillKind,
    at: std::time::Instant,
}

fn pending_choices() -> &'static Mutex<HashMap<String, PendingChoice>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingChoice>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

/// What a submitted form would save, held natively until the person answers.
struct PendingSave {
    profile: String,
    address: Option<(String, Address)>,
    card: Option<(String, Card)>,
    at: std::time::Instant,
}

impl Drop for PendingSave {
    fn drop(&mut self) {
        if let Some((_, card)) = self.card.as_mut() {
            card.number.zeroize();
        }
    }
}

fn pending_saves() -> &'static Mutex<HashMap<String, PendingSave>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingSave>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

/// Tells the window showing this page to draw the chip, or with no kind to close it.
fn show_chip(app: &AppHandle, id: &str, kind: Option<FillKind>, place: MenuPlace) {
    let _ = app.emit_to(
        browser_owner_label(app, id).as_str(),
        "misty://browser-autofill-chip",
        json!({"id": id, "kind": kind.map(FillKind::name), "place": place}),
    );
}

/// Handles `misty-autofill:` messages from the page script. Returns whether the message was one.
pub(super) fn forward(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-autofill" {
        return false;
    }
    let values: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return true;
    };
    let token = values.get("token").map(String::as_str).unwrap_or("");
    if !shortcut_token_matches(&state, id, token) || page_excluded(app, id) {
        return true;
    }
    let (Some(origin), Some(profile)) = (page_origin(app, id), page_profile(app, id)) else {
        return true;
    };
    let app = app.clone();
    let id = id.to_owned();
    let kind = values.get("kind").and_then(|kind| FillKind::parse(kind));
    match (url.path(), kind) {
        ("focus", Some(kind)) => {
            let place = MenuPlace::from_query(&values);
            tauri::async_runtime::spawn(async move {
                let has_saved = saved(&profile)
                    .await
                    .is_ok_and(|records| !chooser_items(&records, kind).is_empty());
                if has_saved
                    && allowed_on(kind, &origin)
                    && choices(&app).await.allows(kind)
                    && page_origin(&app, &id).as_deref() == Some(&origin)
                {
                    show_chip(&app, &id, Some(kind), place);
                }
            });
        }
        ("hide", _) => show_chip(&app, &id, None, MenuPlace::default()),
        ("capture", _) => {
            let data = Zeroizing::new(values.get("data").cloned().unwrap_or_default());
            if data.is_empty() || data.len() > MAX_CAPTURE_BYTES {
                return true;
            }
            tauri::async_runtime::spawn(async move {
                capture(&app, &id, &profile, &origin, &data).await;
            });
        }
        _ => {}
    }
    true
}

/// Opens the list of saved details over a page, after a click on Misty's own chip.
async fn open_chooser(
    app: &AppHandle,
    id: &str,
    profile: &str,
    kind: FillKind,
    x: f64,
    y: f64,
) -> Result<(), String> {
    const MOVED_ON: &str = "This page changed. Click the field again.";
    let origin = page_origin(app, id).ok_or(MOVED_ON)?;
    if page_excluded(app, id) || !allowed_on(kind, &origin) {
        return Err(MOVED_ON.into());
    }
    if !choices(app).await.allows(kind) {
        return Err("Autofill is off in Settings.".into());
    }
    let records = saved(profile).await?;
    let items = chooser_items(&records, kind);
    if items.is_empty() {
        return Err("That item was removed.".into());
    }
    let key = uuid::Uuid::new_v4().to_string();
    if let Ok(mut pending) = pending_choices().lock() {
        // Only a page's latest chooser can answer, and old ones don't pile up.
        pending.retain(|_, choice| choice.page != id);
        pending.insert(
            key.clone(),
            PendingChoice {
                page: id.to_owned(),
                profile: profile.to_owned(),
                origin,
                kind,
                at: std::time::Instant::now(),
            },
        );
    }
    app.emit_to(
        browser_owner_label(app, id).as_str(),
        "misty://browser-autofill-choose",
        json!({"key": key, "id": id, "kind": kind.name(), "x": x, "y": y, "items": items}),
    )
    .map_err(|error| error.to_string())
}

/// Decides what a submitted form would save and asks. The renderer learns only the labels.
async fn capture(app: &AppHandle, id: &str, profile: &str, origin: &str, data: &str) {
    let Ok(form) = serde_json::from_str::<CapturedForm>(data) else {
        return;
    };
    let wanted = choices(app).await;
    if !wanted.offer_to_save {
        return;
    }
    let Ok(records) = saved(profile).await else {
        return;
    };
    let now = now_ms();
    let address = form
        .address
        .filter(|_| wanted.addresses)
        .and_then(|captured| address_to_save(&captured, &records_of(&records, Kind::Address), now));
    let card = form
        .card
        .filter(|_| wanted.cards && allowed_on(FillKind::Card, origin))
        .and_then(|captured| card_to_save(&captured, &records_of(&records, Kind::Card), now));
    if address.is_none() && card.is_none() {
        return;
    }
    let update = address.as_ref().is_some_and(|(id, _)| id.is_some())
        || card.as_ref().is_some_and(|(id, _)| id.is_some());
    let address_text = address.as_ref().map(|(_, address)| address_label(address));
    let card_text = card.as_ref().map(|(_, card)| card_label(card));
    let keep = |existing: Option<String>, prefix: &str| {
        existing.unwrap_or_else(|| format!("{prefix}:{}", uuid::Uuid::new_v4()))
    };
    if let Ok(mut pending) = pending_saves().lock() {
        pending.insert(
            id.to_owned(),
            PendingSave {
                profile: profile.to_owned(),
                address: address.map(|(existing, address)| (keep(existing, "address"), address)),
                card: card.map(|(existing, card)| (keep(existing, "card"), card)),
                at: std::time::Instant::now(),
            },
        );
    }
    crate::browser::app_windows::emit_to_profile_people(
        app,
        profile,
        "misty://browser-autofill-offer",
        json!({
            "id": id,
            "origin": origin,
            "address": address_text,
            "card": card_text,
            "update": update,
        }),
    );
}

/// Fills the pick into the page that asked, only while that page is still on the same site.
async fn fill(app: &AppHandle, choice: &PendingChoice, item: &str) -> Result<(), String> {
    const GONE: &str = "That item was removed.";
    let same_site = || page_origin(app, &choice.page).as_deref() == Some(&choice.origin);
    let moved_on = "This page changed, so nothing was filled.";
    if !same_site() || page_excluded(app, &choice.page) || !allowed_on(choice.kind, &choice.origin)
    {
        return Err(moved_on.into());
    }
    if !choices(app).await.allows(choice.kind) {
        return Err("Autofill is off in Settings.".into());
    }
    let values = match choice.kind {
        FillKind::Address => {
            let (_, address) = addresses(&choice.profile)
                .await?
                .into_iter()
                .find(|(id, _)| id == item)
                .ok_or(GONE)?;
            json!({
                "name": address.name,
                "organization": address.organization,
                "street": address.street,
                "city": address.city,
                "region": address.region,
                "postalCode": address.postal_code,
                "country": address.country,
                "phone": address.phone,
                "email": address.email,
            })
        }
        FillKind::Card => {
            let (_, card) = cards(&choice.profile)
                .await?
                .into_iter()
                .find(|(id, _)| id == item)
                .ok_or(GONE)?;
            let reason = format!(
                "fill your {} on {}",
                card_label(&card),
                host_of(&choice.origin)
            );
            let owner = browser_owner_label(app, &choice.page);
            let window = app.get_window(&owner).ok_or(moved_on)?;
            crate::browser::autofill::confirm(&window, &reason).await?;
            // The prompt can take a while: the page may have gone somewhere else meanwhile.
            if !same_site() {
                return Err(moved_on.into());
            }
            json!({
                "number": card.number,
                "holder": card.holder,
                "expMonth": card.exp_month,
                "expYear": card.exp_year,
            })
        }
    };
    let script = Zeroizing::new(format!(
        "window.__MISTY_AUTOFILL__?.fill({:?}, {values});",
        choice.kind.name()
    ));
    reply(app, &choice.page, script.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_stay_on_encrypted_pages_and_addresses_go_anywhere() {
        assert!(allowed_on(FillKind::Card, "https://shop.example"));
        assert!(!allowed_on(FillKind::Card, "http://shop.example"));
        assert!(!allowed_on(FillKind::Card, "http://localhost.example"));
        assert!(!allowed_on(FillKind::Card, "http://127.0.0.1.example"));
        assert!(allowed_on(FillKind::Address, "http://shop.example"));
    }
}
