//! A person's connected Google Calendar, read for their own Calendar page. This is not an agent's
//! call: no run asks for it and nothing here writes. Native code fixes the one tool that runs and
//! its arguments, so the page chooses only the time range, and what comes back goes to that page
//! and nowhere else: never to a Misty server.
use chrono::{DateTime, Duration, FixedOffset};
use serde::Serialize;
use serde_json::{json, Value};

use super::{
    client::{truncate, Client},
    tools::{failure, rejected, Failure},
};

const TOOLKIT: &str = "googlecalendar";
/// Composio's read of one calendar's events. Nothing else is ever run from here.
const LIST_EVENTS: &str = "GOOGLECALENDAR_EVENTS_LIST";
/// A month's grid is six weeks; a page never needs more.
const MAX_RANGE_DAYS: i64 = 62;
const MAX_ACCOUNTS: usize = 4;
const MAX_EVENTS: usize = 250;
const MAX_TEXT: usize = 500;

/// One event of a connected calendar, as the Calendar page draws it.
#[derive(Debug, PartialEq, Serialize)]
pub struct CalendarEvent {
    pub id: String,
    /// The connected account it came from.
    pub account: String,
    pub title: String,
    pub location: String,
    /// When it starts and ends. An all-day event has `day` instead.
    pub starts_at: String,
    pub ends_at: String,
    pub all_day: bool,
    /// `yyyy-mm-dd`, for an all-day event.
    pub day: String,
    /// The event's page in Google Calendar.
    pub url: String,
}

fn moment(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value).ok()
}

/// The events array, wherever Composio's answer holds it.
fn items(data: &Value) -> Vec<Value> {
    if let Value::String(text) = data {
        return serde_json::from_str::<Value>(text)
            .map(|parsed| items(&parsed))
            .unwrap_or_default();
    }
    for found in [
        &data["items"],
        &data["response_data"]["items"],
        &data["data"]["items"],
    ] {
        if let Some(list) = found.as_array() {
            return list.clone();
        }
    }
    Vec::new()
}

fn text(value: &Value) -> String {
    truncate(value.as_str().unwrap_or_default().trim(), MAX_TEXT)
}

/// A Google event as the page's row. Canceled events and ones with no readable time are dropped.
fn event_of(item: &Value, account: &str) -> Option<CalendarEvent> {
    if item["status"] == "cancelled" {
        return None;
    }
    let id = item["id"].as_str().filter(|id| !id.is_empty())?;
    let title = match text(&item["summary"]) {
        empty if empty.is_empty() => "Busy".to_owned(),
        title => title,
    };
    let url = item["htmlLink"]
        .as_str()
        .filter(|link| link.starts_with("https://"))
        .unwrap_or_default()
        .to_owned();
    let mut event = CalendarEvent {
        id: format!("{account}:{id}"),
        account: account.to_owned(),
        title,
        location: text(&item["location"]),
        starts_at: String::new(),
        ends_at: String::new(),
        all_day: false,
        day: String::new(),
        url,
    };
    if let Some(day) = item["start"]["date"].as_str() {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
        event.all_day = true;
        event.day = day.to_owned();
        return Some(event);
    }
    let starts = moment(item["start"]["dateTime"].as_str()?)?;
    let ends = item["end"]["dateTime"]
        .as_str()
        .and_then(moment)
        .filter(|ends| *ends >= starts)
        .unwrap_or(starts);
    event.starts_at = starts.to_rfc3339();
    event.ends_at = ends.to_rfc3339();
    Some(event)
}

/// The events between `from` and `to` on the primary calendar of each connected Google account.
pub async fn events(client: &Client, from: &str, to: &str) -> Result<Vec<CalendarEvent>, Failure> {
    let range = moment(from)
        .zip(moment(to))
        .filter(|(from, to)| to > from && *to - *from <= Duration::days(MAX_RANGE_DAYS));
    let Some((from, to)) = range else {
        return Err(rejected(
            "invalid_request",
            "The calendar range isn't valid.",
        ));
    };
    let accounts = client
        .accounts(TOOLKIT)
        .await
        .map_err(|error| failure(error, false))?;
    let arguments = json!({
        "calendarId": "primary",
        "timeMin": from.to_rfc3339(),
        "timeMax": to.to_rfc3339(),
        "singleEvents": true,
        "orderBy": "startTime",
        "maxResults": MAX_EVENTS,
    });
    let mut found = Vec::new();
    for account in accounts
        .iter()
        .filter(|item| item.active())
        .take(MAX_ACCOUNTS)
    {
        let (arguments, id) = (&arguments, account.id.as_str());
        let execution = client
            .with_session(|session| async move {
                client.execute(&session, LIST_EVENTS, arguments, id).await
            })
            .await
            .map_err(|error| failure(error, false))?;
        let refused = execution.error.as_deref().unwrap_or_default().trim();
        if !refused.is_empty()
            || execution
                .result_type
                .as_deref()
                .is_some_and(|kind| kind != "completed")
        {
            return Err(rejected(
                "apps_rejected",
                "Google Calendar didn't return its events. Try reconnecting it.",
            ));
        }
        let data = execution.data.unwrap_or(Value::Null);
        found.extend(
            items(&data)
                .iter()
                .take(MAX_EVENTS)
                .filter_map(|item| event_of(item, id)),
        );
    }
    Ok(found)
}
