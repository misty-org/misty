//! What running an app tool does to the person's accounts, and what that needs from them. Native on
//! purpose: the model and the page can't reach it.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{api::ToolInfo, client::truncate};
use crate::infra::agent_runtime::tool_question::{shown_fields, MAX_SHOWN};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Read,
    /// Creates or changes the person's own data.
    Write,
    /// Reaches other people or money: sending, publishing, sharing, inviting, paying, changing access.
    Consequential,
    /// Removes data.
    Destructive,
}

impl Kind {
    fn needs_approval(self) -> bool {
        matches!(self, Self::Consequential | Self::Destructive)
    }
}

const DESTRUCTIVE: &[&str] = &[
    "DELETE", "DELETES", "REMOVE", "REMOVES", "TRASH", "PURGE", "ERASE", "DESTROY", "WIPE",
];
const CONSEQUENTIAL: &[&str] = &[
    "SEND",
    "SENDS",
    "REPLY",
    "FORWARD",
    "POST",
    "POSTS",
    "PUBLISH",
    "SHARE",
    "SHARING",
    "INVITE",
    "TWEET",
    "RETWEET",
    "BROADCAST",
    "SUBMIT",
    "TRANSFER",
    "PAY",
    "PAYMENT",
    "PURCHASE",
    "BUY",
    "ORDER",
    "CHARGE",
    "REFUND",
    "PERMISSION",
    "PERMISSIONS",
    "REVOKE",
    "GRANT",
    "MERGE",
    "DEPLOY",
    "CANCEL",
];
/// Things that reach other people when one is made, past the verbs above: `*_CREATE_MESSAGE`.
const SEND_NOUNS: &[&str] = &["MESSAGE", "MESSAGES", "EMAIL", "EMAILS", "COMMENT", "COMMENTS", "DM", "SMS"];
const MAKES: &[&str] = &["CREATE", "ADD", "NEW", "WRITE", "COMPOSE", "START"];
/// Made for the person alone: a draft or a label stays with them.
const STAYS_PRIVATE: &[&str] = &["DRAFT", "DRAFTS", "LABEL", "LABELS", "FOLDER", "FILTER"];
const READ: &[&str] = &[
    "GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "RETRIEVE", "QUERY", "LOOKUP", "VIEW",
    "COUNT", "CHECK",
];
const PAYMENT: &[&str] = &[
    "PAY", "PAYMENT", "PAYMENTS", "CHARGE", "PURCHASE", "BUY", "CHECKOUT", "TRANSFER", "PAYOUT",
    "REFUND", "CAPTURE",
];

/// Composio's behavior tags first, then the action the slug names. It classifies a tool, never the
/// person's request.
pub fn classify(slug: &str, tags: &[String]) -> Kind {
    let tagged = |tag: &str| tags.iter().any(|item| item == tag);
    let upper = slug.to_uppercase();
    let parts: Vec<&str> = upper.split('_').collect();
    let names = |set: &[&str]| parts.iter().any(|part| set.contains(part));
    if tagged("destructiveHint") {
        return Kind::Destructive;
    }
    if tagged("readOnlyHint") {
        return Kind::Read;
    }
    if names(DESTRUCTIVE) {
        return Kind::Destructive;
    }
    if names(CONSEQUENTIAL) {
        return Kind::Consequential;
    }
    // Untagged tools name their action after the toolkit: GMAIL_FETCH_EMAILS.
    if !tagged("createHint") && !tagged("updateHint") && parts.len() > 1 && READ.contains(&parts[1])
    {
        return Kind::Read;
    }
    if names(SEND_NOUNS) && names(MAKES) && !names(STAYS_PRIVATE) {
        return Kind::Consequential;
    }
    Kind::Write
}

fn is_payment(slug: &str) -> bool {
    slug.to_uppercase()
        .split('_')
        .any(|word| PAYMENT.contains(&word))
}

/// A payment's amount, and a payment grant's per-payment cap.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Amount {
    pub max_amount_minor: i64,
    pub currency: String,
}

/// What one action needs from the person: the action, the one resource it touches and, for payments,
/// the amount. Derived from the call about to run, never from what the person answered.
#[derive(Clone, Debug, PartialEq)]
pub struct GrantNeed {
    pub action: &'static str,
    pub scope_kind: &'static str,
    pub scope_id: String,
    /// Names the scope for people: "act in Gmail (me@example.com)".
    pub label: String,
    pub amount: Option<Amount>,
}

pub const ACTION_WRITE: &str = "tool.write";
pub const ACTION_APP: &str = "app.action";
pub const ACTION_PAYMENT: &str = "payment";

fn payment_amount(arguments: &Value) -> Option<Amount> {
    let amount = match &arguments["amount"] {
        Value::Number(number) => number.as_i64()?,
        Value::String(text) => text.trim().parse().ok()?,
        _ => return None,
    };
    let currency = arguments["currency"].as_str()?.trim().to_lowercase();
    (amount > 0 && currency.chars().count() == 3).then_some(Amount {
        max_amount_minor: amount,
        currency,
    })
}

fn format_amount(amount: &Amount) -> String {
    format!(
        "{}.{:02} {}",
        amount.max_amount_minor / 100,
        amount.max_amount_minor % 100,
        amount.currency.to_uppercase()
    )
}

fn app_name(info: &ToolInfo) -> &str {
    match info.toolkit.name.trim() {
        "" => &info.toolkit.slug,
        name => name,
    }
}

pub fn grant_need(info: &ToolInfo, arguments: &Value, account: &str, kind: Kind) -> GrantNeed {
    let payment = is_payment(&info.slug);
    if !kind.needs_approval() && !payment {
        return GrantNeed {
            action: ACTION_WRITE,
            scope_kind: "",
            scope_id: String::new(),
            label: String::new(),
            amount: None,
        };
    }
    let app = app_name(info);
    let toolkit = info.toolkit.slug.trim().to_lowercase();
    if payment {
        let amount = payment_amount(arguments);
        return GrantNeed {
            action: ACTION_PAYMENT,
            scope_kind: "merchant",
            scope_id: toolkit,
            label: amount
                .as_ref()
                .map(|amount| format!("pay through {app} up to {}", format_amount(amount)))
                .unwrap_or_default(),
            amount,
        };
    }
    let account = account.trim();
    GrantNeed {
        action: ACTION_APP,
        scope_kind: "connected_account",
        scope_id: format!(
            "{toolkit}:{}",
            if account.is_empty() {
                "default"
            } else {
                account
            }
        ),
        label: if account.is_empty() {
            format!("act in {app}")
        } else {
            format!("act in {app} ({account})")
        },
        amount: None,
    }
}

impl GrantNeed {
    /// Whether this can become a grant: one concrete resource, and a payment with an amount to cap.
    pub fn rememberable(&self) -> bool {
        let concrete = !self.scope_id.is_empty()
            && self.scope_id.len() <= 300
            && !self.scope_id.contains(['*', '?']);
        match self.action {
            ACTION_APP => concrete,
            ACTION_PAYMENT => concrete && self.amount.is_some(),
            _ => false,
        }
    }

    /// Whether a stored grant's cap allows this exact action.
    pub fn covered_by(&self, cap: Option<&Amount>) -> bool {
        if self.action != ACTION_PAYMENT {
            return true;
        }
        match (cap, &self.amount) {
            (Some(limit), Some(amount)) => {
                limit.currency.eq_ignore_ascii_case(&amount.currency)
                    && amount.max_amount_minor <= limit.max_amount_minor
            }
            _ => false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Decision {
    Allow,
    Pause,
}

/// The rule for one write in one mode. Ask pauses before everything and ignores grants. Auto continues
/// on smaller writes, and on the rest only when a remembered approval covers them.
pub fn decide(mode: &str, need: &GrantNeed, covered: bool) -> Decision {
    if mode != "auto" {
        return Decision::Pause;
    }
    if need.action == ACTION_WRITE || covered {
        Decision::Allow
    } else {
        Decision::Pause
    }
}

/// The approval card: the app and action, then the exact arguments being approved, all of them. Too
/// long to show whole is `None`, and the call is refused with word to make a smaller one.
pub fn action_summary(info: &ToolInfo, arguments: &Value, account: &str) -> Option<(String, String)> {
    let action = match info.name.trim() {
        "" => info.slug.to_lowercase().replace('_', " "),
        name => name.to_owned(),
    };
    let title = truncate(&format!("{} · {action}", app_name(info)), 200);
    let mut lines = shown_fields(arguments);
    if !account.is_empty() {
        lines.push(format!("account: {account}"));
    }
    let summary = lines.join("\n");
    (summary.chars().count() <= MAX_SHOWN).then_some((title, summary))
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(fields) => {
            let mut sorted: Vec<(&String, &Value)> = fields.iter().collect();
            sorted.sort_by_key(|(key, _)| key.as_str());
            Value::Array(
                sorted
                    .into_iter()
                    .map(|(key, value)| Value::Array(vec![key.clone().into(), canonical(value)]))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// Binds an approval to one exact tool, arguments and account.
pub fn arguments_hash(slug: &str, arguments: &Value, account: &str) -> String {
    let canonical = Value::Array(vec![slug.into(), canonical(arguments), account.into()]);
    hex::encode(Sha256::digest(canonical.to_string().as_bytes()))
}
