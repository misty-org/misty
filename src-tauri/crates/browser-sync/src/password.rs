//! The rules for a vault password, the same as for a Misty password: at least 8
//! characters, a lowercase letter and a special character. The server never
//! receives a vault password, so the check runs on the device before keys are
//! derived from it. The website (`misty-website/src/lib/accountPassword.ts`) and
//! the server (`accounts.ValidateNewPassword`) keep the same rules for sign-in.

use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasswordIssue {
    TooShort,
    TooLong,
    NoLowercase,
    NoSpecial,
}

impl PasswordIssue {
    pub fn message(self) -> &'static str {
        match self {
            Self::TooShort => "Use at least 8 characters.",
            Self::TooLong => "Use 1,024 bytes or fewer.",
            Self::NoLowercase => "Include a lowercase letter.",
            Self::NoSpecial => "Include a special character.",
        }
    }
}

/// The shortest password, in characters (not bytes: four CJK characters are twelve bytes).
pub const MIN_CHARS: usize = 8;
/// Not a rule for people: the most the key derivation takes.
pub const MAX_BYTES: usize = 1024;

/// Why this password can't be used for a new vault or a new password. Signing
/// in never asks, so an older password that doesn't meet these still works.
pub fn check(password: &str) -> Result<(), PasswordIssue> {
    // The rules apply to the text the keys are derived from (see `vault::keys`).
    let password = password.nfkc().collect::<String>();
    if password.chars().count() < MIN_CHARS {
        return Err(PasswordIssue::TooShort);
    }
    if password.len() > MAX_BYTES {
        return Err(PasswordIssue::TooLong);
    }
    if !password.chars().any(char::is_lowercase) {
        return Err(PasswordIssue::NoLowercase);
    }
    if password.chars().all(char::is_alphanumeric) {
        return Err(PasswordIssue::NoSpecial);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_long_and_missing_characters() {
        assert_eq!(check("short1!"), Err(PasswordIssue::TooShort));
        // Twelve bytes, but four characters.
        assert_eq!(check("密码密码"), Err(PasswordIssue::TooShort));
        assert_eq!(check(&"a!".repeat(513)), Err(PasswordIssue::TooLong));
        assert_eq!(check("ALLCAPS123!"), Err(PasswordIssue::NoLowercase));
        assert_eq!(check("NoSpecial123"), Err(PasswordIssue::NoSpecial));
    }

    #[test]
    fn accepts_what_meets_every_rule() {
        for ok in ["Abcdef1!", "Correct horse 9", "tR9#vq2-lemon", "lower-only"] {
            assert_eq!(check(ok), Ok(()), "{ok}");
        }
    }
}
