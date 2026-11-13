use serde::Serialize;

use super::{
    policy::{Amount, ACTION_PAYMENT},
    requests::Request,
};

/// The card as the app shows it. The hash and what a grant holds stay here.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub id: String,
    pub kind: String,
    pub subject: String,
    pub title: String,
    pub summary: String,
    pub state: String,
    pub expires_at: String,
    pub rememberable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remember_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_cap: Option<Amount>,
}

impl Request {
    pub fn view(&self) -> RequestView {
        let grant = self.grant.as_ref();
        RequestView {
            id: self.id.clone(),
            kind: self.kind.clone(),
            subject: self.subject.clone(),
            title: self.title.clone(),
            summary: self.summary.clone(),
            state: self.state.clone(),
            expires_at: chrono::DateTime::from_timestamp_millis(self.expires_at)
                .unwrap_or_default()
                .to_rfc3339(),
            rememberable: grant.is_some(),
            remember_label: grant.map(|grant| grant.label.clone()),
            permission_mode: (!self.permission_mode.is_empty())
                .then(|| self.permission_mode.clone()),
            payment_cap: grant
                .filter(|grant| grant.action == ACTION_PAYMENT)
                .and_then(|grant| grant.cap.clone()),
        }
    }
}
