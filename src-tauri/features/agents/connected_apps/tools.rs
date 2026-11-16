//! What the agent tools get back (`src/features/agents/tools/appsTools.ts`), other than running a tool
//! (`execute`).
use serde::Serialize;

use super::api::SearchResult;

/// Why a call didn't produce a result. `uncertain` means it may have taken effect.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub uncertain: bool,
}

pub(super) fn rejected(code: &str, message: impl Into<String>) -> Failure {
    Failure {
        code: code.to_owned(),
        message: message.into(),
        uncertain: false,
    }
}

pub(super) const NOT_CONNECTED: &str = "No apps are connected on this computer. Use the app's web \
     page in the browser instead. The person can connect apps in Misty's Apps page.";

pub(super) fn storage_failure(message: String) -> Failure {
    rejected("apps_storage", message)
}

/// An app account the person connected, as the agent sees it.
#[derive(Debug, PartialEq, Serialize)]
pub struct ActiveAccount {
    pub app: String,
    pub account: String,
    pub alias: String,
    pub status: String,
}

/// What a search found: matching tools, and the accounts they can run as.
#[derive(Debug, Serialize)]
pub struct Search {
    pub found: SearchResult,
    pub accounts: Vec<ActiveAccount>,
}
