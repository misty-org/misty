//! One cookie's synced state, and the rule that decides between two copies of it. Pure: the same
//! inputs give the same answer on every computer, in any order, which is what lets two of them
//! exchange records until they agree.
use browser_data::document::credentials::{Cookie, SameSite};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;

const DAY_MS: u64 = 86_400_000;
/// Deletions are kept this long so a sign-out reaches a computer that was away.
const KEEP_DELETIONS_MS: u64 = 90 * DAY_MS;
/// A site that re-sets a cookie on every response pushes its expiry a little each time. Only a
/// bigger move is worth a record, or a page's traffic would become a stream of writes.
const EXPIRY_SLACK_SECONDS: i64 = 3_600;
/// How long a change made in use holds against an idle change made on top of it. A background tab
/// on a computer nobody is at keeps refreshing tokens, and those mustn't land on the computer the
/// person is using. Past this nobody is using that copy, so a refresh sticks and doesn't go stale.
const IN_USE_HOLDS_MS: u64 = 60 * 60 * 1000;

/// One cookie in a site's record. A `None` cookie is a deletion.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Entry {
    pub cookie: Option<Cookie>,
    pub edited_at: u64,
    pub idle: bool,
    /// The edit time of the copy this one replaced, so a change made on top of a copy isn't
    /// mistaken for a conflict with it.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub base: u64,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

/// A site's cookies, by [`cookie_key`].
pub(super) type SiteCookies = BTreeMap<String, Entry>;

/// `<name>|<domain>|<path>`. A domain cookie keeps its leading dot, so it stays apart from a
/// host-only cookie of the same name.
pub(super) fn cookie_key(cookie: &Cookie) -> String {
    let domain = cookie.domain.trim_start_matches('.').to_ascii_lowercase();
    let dot = if cookie.host_only { "" } else { "." };
    format!("{}|{dot}{domain}|{}", cookie.name, cookie.path)
}

fn canonical(entry: &Entry) -> String {
    serde_json::to_string(&entry.cookie).unwrap_or_default()
}

/// Which of two copies wins: `Greater` means `a` does. A copy made on top of the other replaces
/// it, so a site rotating a token on a computer nobody is looking at still sticks, unless the copy
/// it replaces was made in use within [`IN_USE_HOLDS_MS`]. Otherwise, one made in use beats one
/// made while the person was away, whatever the clocks say;
/// otherwise the newest edit wins. A tie falls to a deletion, then to the cookie that sorts last,
/// so both sides pick the same one. `Equal` means the two are identical.
pub(super) fn rank(a: &Entry, b: &Entry) -> Ordering {
    let follows = |x: &Entry, y: &Entry| {
        x.base >= y.edited_at
            && x.edited_at > y.edited_at
            && !(x.idle && !y.idle && x.edited_at - y.edited_at < IN_USE_HOLDS_MS)
    };
    if follows(a, b) {
        return Ordering::Greater;
    }
    if follows(b, a) {
        return Ordering::Less;
    }
    (!a.idle)
        .cmp(&!b.idle)
        .then(a.edited_at.cmp(&b.edited_at))
        .then(a.cookie.is_none().cmp(&b.cookie.is_none()))
        .then_with(|| canonical(a).cmp(&canonical(b)))
}

/// Takes whichever copy wins for each cookie in `theirs`, telling `replaced` about each change
/// with the copy it replaced.
pub(super) fn merge_into(
    ours: &mut SiteCookies,
    theirs: &SiteCookies,
    mut replaced: impl FnMut(&str, Option<&Entry>, &Entry),
) {
    for (key, entry) in theirs {
        let current = ours.get(key);
        if current.is_none_or(|current| rank(entry, current) == Ordering::Greater) {
            replaced(key, current, entry);
            ours.insert(key.clone(), entry.clone());
        }
    }
}

/// Whether two sites' entries are the same, so rewriting one would change nothing.
pub(super) fn same_entries(a: &SiteCookies, b: &SiteCookies) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|((ka, ea), (kb, eb))| ka == kb && rank(ea, eb) == Ordering::Equal)
}

/// Forgets deletions old enough to have reached everyone, and cookies long past their expiry.
pub(super) fn age_out(entries: &mut SiteCookies, now_ms: u64) {
    entries.retain(|_, entry| match &entry.cookie {
        None => entry.edited_at.saturating_add(KEEP_DELETIONS_MS) >= now_ms,
        Some(cookie) => cookie.expires_unix_seconds.is_none_or(|expires| {
            (expires.max(0) as u64)
                .saturating_mul(1000)
                .saturating_add(KEEP_DELETIONS_MS)
                >= now_ms
        }),
    });
}

pub(super) fn expired(cookie: &Cookie, now_ms: u64) -> bool {
    cookie
        .expires_unix_seconds
        .is_some_and(|expires| (expires.max(0) as u64).saturating_mul(1000) <= now_ms)
}

/// Whether the engine still holds the cookie a record has, given two copies with the same key.
/// An engine that can't report `SameSite=None` reads it as unspecified, and one that clamps long
/// expiries reads back a shorter one: neither is a change, or it would loop.
pub(super) fn same_cookie(stored: &Cookie, engine: &Cookie, conflates_none: bool) -> bool {
    stored.value == engine.value
        && stored.secure == engine.secure
        && stored.http_only == engine.http_only
        && same_policy(stored, engine, conflates_none)
        && match (stored.expires_unix_seconds, engine.expires_unix_seconds) {
            (None, None) => true,
            (Some(stored), Some(engine)) => engine.saturating_sub(stored) < EXPIRY_SLACK_SECONDS,
            _ => false,
        }
}

fn same_policy(stored: &Cookie, engine: &Cookie, conflates_none: bool) -> bool {
    match (&stored.same_site, &engine.same_site) {
        (None, None)
        | (Some(SameSite::Lax), Some(SameSite::Lax))
        | (Some(SameSite::Strict), Some(SameSite::Strict))
        | (Some(SameSite::None), Some(SameSite::None)) => true,
        (Some(SameSite::None), None) => conflates_none && engine.secure,
        _ => false,
    }
}

/// A cookie as it goes in a record. An engine that can't report `SameSite=None` reads it as
/// unspecified and enforces that as `None`, so a secure one is recorded as `None`. Left unspecified,
/// an engine that defaults to `Lax` would stop sending it cross-site, and sign-ins that cross sites
/// would break there.
pub(super) fn aligned(mut engine: Cookie, conflates_none: bool) -> Cookie {
    if conflates_none && engine.same_site.is_none() && engine.secure {
        engine.same_site = Some(SameSite::None);
    }
    engine
}
