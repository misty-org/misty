//! Live cookie round trips, profile guards and host/domain scope.
use super::*;

pub(super) async fn check(
    a: &Webview,
    b: &Webview,
    peer: &Webview,
    ephemeral: &Webview,
    host: &Webview,
    a_id: &str,
    b_id: &str,
) -> Result<()> {
    if !read(a, a_id).await?.is_empty() || !read(b, b_id).await?.is_empty() {
        return Err("random profiles were not empty");
    }
    for (view, id) in [(a, b_id), (ephemeral, a_id), (host, a_id)] {
        if !matches!(
            cookies::verify_storage_profile(view, id).await,
            Err(cookies::CookieStoreError::Profile)
        ) {
            return Err("profile guard failed");
        }
    }
    let tomorrow = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock unavailable")?
        .as_secs() as i64
        + 86_400;
    let mut count = 0;
    for domain in ["example.test", ".example.test"] {
        for expires in [None, Some(tomorrow)] {
            for policy in [SameSite::Lax, SameSite::Strict, SameSite::None] {
                for secure in [true, false] {
                    if !secure && matches!(policy, SameSite::None) {
                        continue;
                    }
                    for http_only in [true, false] {
                        let mut cookie = fixture();
                        cookie.domain = domain.into();
                        cookie.host_only = !domain.starts_with('.');
                        cookie.expires_unix_seconds = expires;
                        cookie.same_site = Some(policy.clone());
                        cookie.secure = secure;
                        cookie.http_only = http_only;
                        write(a, a_id, cookie.clone(), false).await?;
                        let actual = read(peer, a_id).await?;
                        // Foundation never reports an explicit SameSite=None. Sync keeps it
                        // from the synced copy; everything else must come back exact.
                        let mut expected = cookie.clone();
                        if matches!(expected.same_site, Some(SameSite::None)) {
                            expected.same_site = None;
                        }
                        if actual.len() != 1
                            || serde_json::to_value(&actual[0]).ok()
                                != serde_json::to_value(&expected).ok()
                        {
                            return Err("cookie attributes changed in the live store");
                        }
                        if !read(b, b_id).await?.is_empty() {
                            return Err("cookie crossed profile boundary");
                        }
                        write(a, a_id, cookie, true).await?;
                        if !read(peer, a_id).await?.is_empty() {
                            return Err("cookie deletion did not complete");
                        }
                        count += 1;
                    }
                }
            }
        }
    }
    // Host and domain cookies share a name/path but have distinct scope.
    let host_cookie = fixture();
    let mut domain_cookie = fixture();
    domain_cookie.host_only = false;
    domain_cookie.domain = ".example.test".into();
    write(a, a_id, host_cookie.clone(), false).await?;
    write(a, a_id, domain_cookie.clone(), false).await?;
    if read(peer, a_id).await?.len() != 2 {
        return Err("host/domain scope collapsed");
    }
    write(a, a_id, host_cookie, true).await?;
    let remaining = read(peer, a_id).await?;
    if remaining.len() != 1 || remaining[0].host_only {
        return Err("host deletion changed the domain cookie");
    }
    write(a, a_id, domain_cookie, true).await?;
    if !read(peer, a_id).await?.is_empty() {
        return Err("final store not empty");
    }
    println!("PASS: {count} live cookie round trips, completion callbacks, profile guards, same-profile visibility, isolation, and host/domain coexistence");
    // What sync does with another computer's cookies: bring them in, then sign out of them.
    let mut source = Vec::new();
    for name in ["session", "preferences", "csrf"] {
        let mut cookie = fixture();
        cookie.name = name.into();
        write(a, a_id, cookie.clone(), false).await?;
        write(b, b_id, cookie.clone(), false).await?;
        source.push(cookie);
    }
    let names = |cookies: Vec<Cookie>| {
        let mut names: Vec<String> = cookies.into_iter().map(|cookie| cookie.name).collect();
        names.sort();
        names
    };
    if names(read(b, b_id).await?) != names(source.clone()) {
        return Err("applied copy differs from the source");
    }
    for cookie in source {
        write(b, b_id, cookie, true).await?;
    }
    if !read(b, b_id).await?.is_empty() {
        return Err("signing out did not clear the copy");
    }
    if read(a, a_id).await?.len() != 3 {
        return Err("signing out changed the source profile");
    }
    println!("PASS: applying a copy and signing out, with the source profile untouched");
    Ok(())
}
