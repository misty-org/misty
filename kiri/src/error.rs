use serde::Serialize;

/// A failure reported back to the page. `name` is the DOMException (or
/// `TypeError`) the page-side shim throws, so websites see the same errors a
/// full browser would give them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KiriError {
    pub name: &'static str,
    pub message: String,
}

impl KiriError {
    fn new(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            name,
            message: message.into(),
        }
    }

    /// The API, method or platform support does not exist here.
    pub fn not_supported(message: impl Into<String>) -> Self {
        Self::new("NotSupportedError", message)
    }

    /// The user or the embedder declined.
    pub fn not_allowed(message: impl Into<String>) -> Self {
        Self::new("NotAllowedError", message)
    }

    /// The caller is not a context that may use this API at all.
    pub fn security(message: impl Into<String>) -> Self {
        Self::new("SecurityError", message)
    }

    /// The request conflicts with existing state, e.g. an excluded credential.
    pub fn invalid_state(message: impl Into<String>) -> Self {
        Self::new("InvalidStateError", message)
    }

    /// The page passed arguments the API does not accept.
    pub fn type_error(message: impl Into<String>) -> Self {
        Self::new("TypeError", message)
    }
}

impl std::fmt::Display for KiriError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for KiriError {}
