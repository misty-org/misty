//! Provider admission and automation rules. Ordinary website redirects may leave these origins.
use url::Url;
pub fn domains(provider: &str) -> Option<Vec<&'static str>> {
    static POLICIES: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    let policies = POLICIES.get_or_init(|| serde_json::from_str(include_str!("browser-providers.json")).expect("valid provider registry"));
    let policy = policies.get(provider)?;
    Some(policy["domains"].as_array()?.iter().chain(policy["auth"].as_array()?.iter()).filter_map(|value| value.as_str()).collect())
}
pub fn allows(provider: &str, url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && url.port_or_known_default() == Some(443)
        && domains(provider).is_some_and(|domains| url.host_str().is_some_and(|host|
            domains.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_boundaries_allow_login_and_block_escape() {
        for (provider, urls) in [
            ("instagram", vec!["https://www.instagram.com/direct/inbox/", "https://www.instagram.com/accounts/login/", "https://www.facebook.com/login.php", "https://www.facebook.com/dialog/oauth", "https://www.facebook.com/checkpoint/"]),
            ("google", vec!["https://mail.google.com/mail/u/0/", "https://accounts.google.com/ServiceLogin"]),
            ("microsoft", vec!["https://outlook.office.com/mail/", "https://outlook.cloud.microsoft/mail/", "https://login.microsoftonline.com/common/oauth2/authorize"]),
            ("x", vec!["https://x.com/i/jf/onboarding/web", "https://accounts.google.com/o/oauth2/auth", "https://appleid.apple.com/auth/authorize", "https://idmsa.apple.com/appleauth/auth/authorize"]),
            ("messenger", vec!["https://www.messenger.com/", "https://www.facebook.com/messages/", "https://www.facebook.com/login.php"]),
            ("slack", vec!["https://app.slack.com/client/", "https://example.slack.com/signin", "https://accounts.google.com/o/oauth2/auth"]),
            ("microsoft-teams", vec!["https://teams.microsoft.com/", "https://teams.cloud.microsoft/", "https://teams.live.com/", "https://login.microsoftonline.com/common/oauth2/authorize"]),
            ("icloud", vec!["https://www.icloud.com/mail/", "https://idmsa.apple.com/appleauth/auth/authorize"]),
            ("yahoo", vec!["https://mail.yahoo.com/", "https://login.yahoo.com/"]),
            ("discord", vec!["https://discord.com/channels/@me", "https://discord.com/login"]),
        ] { for url in urls { assert!(allows(provider, &Url::parse(url).unwrap())); } }
        for url in ["https://instagram.com.evil.test/", "https://facebook.com.evil.test/login.php", "https://evilfacebook.com/", "http://facebook.com/login.php", "https://evilinstagram.com/", "http://instagram.com/", "https://user:pass@instagram.com/", "https://example.com/"] {
            assert!(!allows("instagram", &Url::parse(url).unwrap()));
        }
        assert!(!allows("unknown", &Url::parse("https://example.com/").unwrap()));
    }
}

/// Process-local permission for one consent flow; never persisted with website data.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct OAuthCallback {
    pub url: String,
    pub state: String,
}
impl OAuthCallback {
    pub fn allows(&self, url: &Url) -> bool {
        let Ok(expected) = Url::parse(&self.url) else { return false; };
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            && url.origin() == expected.origin() && url.path() == expected.path()
            && url.fragment().is_none()
            && url.query_pairs().filter(|(key, _)| key == "state").map(|(_, value)| value.into_owned()).collect::<Vec<_>>() == [self.state.clone()]
    }
}

#[cfg(test)]
mod callback_tests {
    use super::*;
    #[test]
    fn callback_requires_exact_origin_path_and_state() {
        let callback = OAuthCallback { url: "https://api.example/v1/oauth/connections/google/callback".into(), state: "one-account-flow".into() };
        assert!(callback.allows(&Url::parse("https://api.example/v1/oauth/connections/google/callback?state=one-account-flow&code=fixture").unwrap()));
        assert!(callback.allows(&Url::parse("https://api.example/v1/oauth/connections/google/callback?state=one-account-flow&error=access_denied").unwrap()));
        for value in [
            "https://api.example/v1/oauth/connections/google/callback?state=another-account",
            "https://api.example/v1/oauth/connections/google/callback?state=one-account-flow&state=other",
            "https://api.example/elsewhere?state=one-account-flow",
            "https://api.example.evil/v1/oauth/connections/google/callback?state=one-account-flow",
            "http://api.example/v1/oauth/connections/google/callback?state=one-account-flow",
        ] { assert!(!callback.allows(&Url::parse(value).unwrap())); }
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;
    #[test]
    fn every_registered_service_and_auth_domain_obeys_the_native_boundary() {
        let registry: serde_json::Value = serde_json::from_str(include_str!("browser-providers.json")).unwrap();
        for (provider, policy) in registry.as_object().unwrap() {
            assert!(allows(provider, &Url::parse(policy["url"].as_str().unwrap()).unwrap()), "default URL for {provider}");
            for domain in policy["domains"].as_array().unwrap().iter().chain(policy["auth"].as_array().unwrap().iter()) {
                let domain = domain.as_str().unwrap();
                assert!(allows(provider, &Url::parse(&format!("https://{domain}/")).unwrap()), "domain for {provider}");
                for rejected in [format!("http://{domain}/"), format!("https://{domain}.evil.invalid/"), format!("https://{domain}:444/"), format!("https://user:password@{domain}/")] {
                    assert!(!allows(provider, &Url::parse(&rejected).unwrap()), "escape for {provider}");
                }
            }
        }
    }
}

/// A host-observed login URL can require intervention, but a service URL never
/// proves that an account is signed in. Page text is not used as authority.
pub fn authentication_required(provider: Option<&str>, url: &Url) -> bool {
    let Some(provider) = provider else { return false; };
    let Some(host) = url.host_str() else { return false; };
    static POLICIES: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    let policies = POLICIES.get_or_init(|| serde_json::from_str(include_str!("browser-providers.json")).expect("valid provider registry"));
    let Some(policy) = policies.get(provider) else { return false; };
    let matches = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    // Messenger may open a signed-in Facebook messages surface in its profile.
    // Its URL still does not establish which account is active.
    if provider == "messenger" && matches("facebook.com") && (url.path() == "/messages" || url.path().starts_with("/messages/")) { return false; }

    if policy["auth"].as_array().is_some_and(|domains| domains.iter().filter_map(|v| v.as_str()).any(matches)) {
        return true;
    }
    if !policy["domains"].as_array().is_some_and(|domains| domains.iter().filter_map(|v| v.as_str()).any(matches)) {
        return false;
    }
    let path = url.path().to_ascii_lowercase();
    let segment = |prefix: &str| path == prefix || path.starts_with(&format!("{prefix}/"));
    match provider {
        "instagram" => segment("/accounts/login") || segment("/challenge") || segment("/accounts/onetap"),
        "discord" => segment("/login") || segment("/register") || segment("/verify"),
        "x" => segment("/i/flow/login") || segment("/i/jf/onboarding") || segment("/account/access"),
        "slack" => segment("/signin") || segment("/checkcookie") || segment("/ssb/signin_redirect"),
        "messenger" => segment("/login") || segment("/checkpoint"),
        _ => false,
    }
}

#[cfg(test)]
mod authentication_tests {
    use super::*;
    #[test]
    fn detects_known_login_locations_without_claiming_signed_in_state() {
        for (provider, raw) in [
            ("google", "https://accounts.google.com/ServiceLogin?secret=not-exported"),
            ("microsoft", "https://login.microsoftonline.com/common/oauth2/authorize"),
            ("instagram", "https://www.instagram.com/accounts/login/"),
            ("discord", "https://discord.com/login"),
            ("x", "https://x.com/i/flow/login"),
            ("slack", "https://workspace.slack.com/signin"),
        ] { assert!(authentication_required(Some(provider), &Url::parse(raw).unwrap()), "{provider}"); }
        for (provider, raw) in [
            (Some("google"), "https://mail.google.com/mail/u/0/"),
            (Some("messenger"), "https://www.facebook.com/messages/t/123"),
            (Some("google"), "https://accounts.google.com.evil.invalid/login"),
            (Some("discord"), "https://discord.com/login-history"),
            (Some("unknown"), "https://accounts.google.com/ServiceLogin"),
            (None, "https://example.org/login"),
        ] { assert!(!authentication_required(provider, &Url::parse(raw).unwrap())); }
    }
}
