use serde::Serialize;

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

    pub fn not_supported(message: impl Into<String>) -> Self {
        Self::new("NotSupportedError", message)
    }

    pub fn not_allowed(message: impl Into<String>) -> Self {
        Self::new("NotAllowedError", message)
    }

    pub fn security(message: impl Into<String>) -> Self {
        Self::new("SecurityError", message)
    }

    pub fn invalid_state(message: impl Into<String>) -> Self {
        Self::new("InvalidStateError", message)
    }

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
