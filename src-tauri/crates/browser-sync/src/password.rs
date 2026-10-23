//! The rules for a Misty password. It protects the sync vault, so the check
//! runs on the device before a password is ever used to derive keys: the
//! server sees only a derived credential and cannot enforce any of this.

use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasswordIssue {
    TooShort,
    TooLong,
    TooCommon,
    TooSimple,
    ContainsEmail,
}

impl PasswordIssue {
    pub fn message(self) -> &'static str {
        match self {
            Self::TooShort => "Use at least 12 characters.",
            Self::TooLong => "Use 1,024 bytes or fewer.",
            Self::TooCommon => "That password is too common. Choose one that is harder to guess.",
            Self::TooSimple => "That password is too simple. Mix more words or characters.",
            Self::ContainsEmail => "Don't use your email address in your password.",
        }
    }
}

/// The shortest password, in characters (not bytes: four CJK characters are twelve bytes).
pub const MIN_CHARS: usize = 12;
pub const MAX_BYTES: usize = 1024;

/// Common passwords and the words they are built from, letters only. A
/// password is rejected when its letters, after undoing the usual digit and
/// symbol swaps, are one of these or one repeated. This is a heuristic floor,
/// not a strength meter.
const COMMON: &[&str] = &[
    "password", "passphrase", "mypassword", "yourpassword", "changeme", "default", "secret",
    "qwerty", "qwertyuiop", "qwertyuiopasdfghjkl", "asdfghjkl", "asdfghjklzxcvbnm", "zxcvbnm",
    "abc", "abcd", "abcdef", "abcdefgh", "abcdefghijkl", "iloveyou", "letmein", "welcome",
    "admin", "administrator", "login", "master", "monkey", "dragon", "sunshine", "princess",
    "football", "baseball", "basketball", "soccer", "hockey", "superman", "batman", "trustno",
    "shadow", "michael", "jennifer", "jordan", "hunter", "ranger", "thomas", "charlie",
    "freedom", "whatever", "mustang", "starwars", "computer", "internet", "test", "testing",
    "guest", "hello", "helloworld", "killer", "pokemon", "summer", "winter", "spring", "autumn",
    "ashley", "nicole", "jessica", "daniel", "matthew", "andrew", "michelle", "bailey",
    "liverpool", "chelsea", "arsenal", "cheese", "cookie", "chocolate", "purple", "orange",
    "yellow", "silver", "golden", "diamond", "flower", "butterfly", "rainbow", "misty",
    "mistybrowser", "browser", "sync", "syncpassword", "googlepassword", "facebook", "twitter",
    "instagram", "amazon", "apple", "microsoft", "windows", "linux", "ubuntu", "minecraft",
    "fortnite", "roblox", "steam", "gamer", "gaming", "love", "lovely", "family", "forever",
    "friends", "harley", "access", "baby", "boomer", "cowboy", "cricket", "dallas", "eagles",
    "falcon", "ginger", "heather", "iceman", "jasmine", "kitten", "lakers", "maggie",
    "nascar", "oliver", "peanut", "qazwsx", "rabbit", "samantha", "tigger", "united",
    "victoria", "walter", "xavier", "yankees", "zaq", "zxcvbn", "1qaz2wsx", "qazwsxedc",
];

/// The letters of a password as written, and again after undoing the usual
/// digit and symbol swaps (p@ssw0rd) on its core, so a trailing "1234" or "!"
/// never hides the word.
fn candidates(password: &str) -> [String; 2] {
    let lower = password.to_lowercase();
    let plain = lower.chars().filter(|c| c.is_alphabetic()).collect();
    let swapped = lower
        .trim_matches(|c: char| !c.is_alphabetic())
        .chars()
        .map(|c| match c {
            '@' | '4' => 'a',
            '0' => 'o',
            '1' | '!' | '|' => 'i',
            '3' => 'e',
            '$' | '5' => 's',
            '7' | '+' => 't',
            other => other,
        })
        .filter(|c| c.is_alphabetic())
        .collect();
    [plain, swapped]
}

fn is_common(letters: &str) -> bool {
    if letters.is_empty() {
        return false;
    }
    COMMON.iter().any(|word| {
        letters == *word
            || (letters.len() > word.len()
                && letters.len() % word.len() == 0
                && letters.starts_with(word)
                && letters.as_bytes().chunks(word.len()).all(|c| c == word.as_bytes()))
    })
}

fn sequential(password: &str) -> bool {
    let chars: Vec<char> = password.chars().collect();
    // Digits run around the clock: 9 is followed by 0 and 0 by 9.
    let steps = |from: char, to: char, up: bool| {
        let (from, to) = if up { (from, to) } else { (to, from) };
        if from.is_ascii_digit() && to.is_ascii_digit() {
            (to as i64 - from as i64).rem_euclid(10) == 1
        } else {
            to as i64 - from as i64 == 1
        }
    };
    chars.len() >= MIN_CHARS
        && (chars.windows(2).all(|w| steps(w[0], w[1], true))
            || chars.windows(2).all(|w| steps(w[0], w[1], false)))
}

pub fn check(password: &str, email: &str) -> Result<(), PasswordIssue> {
    // The rules apply to the text the keys are derived from (see `AccountKeys::derive`).
    let password = &password.nfkc().collect::<String>();
    let email = &email.nfkc().collect::<String>();
    if password.chars().count() < MIN_CHARS {
        return Err(PasswordIssue::TooShort);
    }
    if password.len() > MAX_BYTES {
        return Err(PasswordIssue::TooLong);
    }
    let lower = password.to_lowercase();
    let mut distinct: Vec<char> = lower.chars().collect();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() <= 3 || sequential(&lower) {
        return Err(PasswordIssue::TooSimple);
    }
    if candidates(password).iter().any(|letters| is_common(letters)) {
        return Err(PasswordIssue::TooCommon);
    }
    let local = email.trim().to_lowercase();
    let local = local.split('@').next().unwrap_or("");
    if local.chars().count() >= 4 && lower.contains(local) {
        return Err(PasswordIssue::ContainsEmail);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_long_simple_and_common_passwords() {
        let email = "person@example.test";
        assert_eq!(check("short1!", email), Err(PasswordIssue::TooShort));
        // Twelve bytes, but four characters.
        assert_eq!(check("密码密码", email), Err(PasswordIssue::TooShort));
        assert_eq!(check(&"a".repeat(1025), email), Err(PasswordIssue::TooLong));
        for simple in ["aaaaaaaaaaaa", "121212121212", "123456789012", "abcdefghijkl", "210987654321"] {
            assert_eq!(check(simple, email), Err(PasswordIssue::TooSimple), "{simple}");
        }
        for common in [
            "password1234",
            "Password!2024",
            "P@ssw0rd1234",
            "passwordpassword",
            "qwertyuiop12",
            "iloveyou12345",
            "Welcome12345!",
            "letmein123456",
        ] {
            assert_eq!(check(common, email), Err(PasswordIssue::TooCommon), "{common}");
        }
        assert_eq!(
            check("my-person-secret-1", email),
            Err(PasswordIssue::ContainsEmail)
        );
    }

    #[test]
    fn accepts_long_unrelated_passwords() {
        let email = "person@example.test";
        for ok in [
            "correct horse battery staple",
            "tR9#vq2-lemon-harbor",
            "twelve chars ok",
        ] {
            assert_eq!(check(ok, email), Ok(()), "{ok}");
        }
    }
}
