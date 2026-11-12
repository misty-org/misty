// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/fork/title.rs.
//! Fork titles: numbering, stacking and the length cap of `<source session's current name> (fork #N)`.

/// The fork number suffix. It is language-neutral (a product rule): `(fork #1)` is never
/// translated, so the backend can build it directly with no i18n step.
///
/// Building it here and parsing it in `fork_sibling_number` must be exact inverses; both share these constants.
pub(super) const FORK_MARK: &str = " (fork #";

pub(super) const FORK_MARK_END: char = ')';


/// The separator between suffix segments, i.e. the space between the root name and the suffix chain.
pub(super) const FORK_SUFFIX_SEP: char = ' ';


/// The elision mark, placed between the root name and the suffix chain (`A … (fork #4) (fork #5)`):
/// earlier fork segments are no longer in the name. Without it an elided name looks naturally short.
pub(super) const FORK_ELISION_MARK: char = '…';


/// The character cap of one fork title (a product rule).
///
/// Counted in characters, not bytes: titles are often CJK, and cutting bytes splits a character
/// (the same reason as in `history::truncate_chars`).
pub(super) const MAX_FORK_TITLE_CHARS: usize = 80;


/// How many suffix segments the chain keeps (a product rule): deeper forks keep only the newest,
/// older ones are dropped. The segment cap is what leaves `MAX_FORK_TITLE_CHARS` a fixed floor for the root name.
pub(super) const MAX_FORK_SUFFIX_SEGMENTS: usize = 5;


/// Fork title: `<source session's current name> (fork #N)`, with N = 1 + the highest number among its current siblings.
///
/// All four rules are product decisions; don't "tidy" them back to the lowest free number or drop the caps:
/// - Append to the source's current name, stripping nothing: forking a fork gives
///   `A (fork #1) (fork #1)`, so lineage shows in the name. The name can't grow without bound:
///   the segment cap, the 80-character budget and the elision mark all live in `capped_fork_title`.
/// - `max+1`, not the lowest free number: with siblings {#1, #3} the next is #4, and the missing #2
///   is deliberately not reused; a number the person remembers must never be quietly recycled.
/// - The sibling set follows the current names (a rename changes only `custom_title`): once a number
///   is renamed away it stops being a sibling and the space shrinks, the natural result of taking the max.
/// - Siblings are matched against the stored full parent name (including any cap `…`), never a cleaned one:
///   numbers must correspond one to one with the name the sidebar shows.
///
/// Recomputed on every fork, never cached: the numbering depends only on the names in the table right
/// now, and a cache would be a second source of truth.
pub(super) fn next_fork_title(
    db: &crate::engines::support::db::Db,
    engine: &str,
    source_title: &str,
) -> Result<String, String> {
    // Empty-name fallback: the `title` column may be empty (the scanner fills rows that way), and a name
    // starting with a space like `" (fork #1)"` says nothing in the sidebar.
    let parent = match source_title.trim() {
        "" => "Chat",
        name => name,
    };
    let taken = taken_titles(db, engine)?;
    // Siblings are matched on the full stored parent name (`parent` as is, possibly with `…`), not a
    // root name "cleaned" after splitting: `fork_sibling_number` needs the whole string to match, and a
    // differently shaped parent name would change the sibling set and split the numbering from the
    // name the sidebar actually shows. One thing can't have two criteria.
    let sibling_max = taken
        .iter()
        .filter_map(|name| fork_sibling_number(parent, name))
        .max()
        .unwrap_or(0);
    // Start at `max+1`: normally the first try returns. Searching further covers two edge cases, both
    // "two sessions with the same name the sidebar can't tell apart":
    //   1. some session's effective name already equals the name we'd give (typically a session whose
    //      first message was literally `A (fork #1)`, so its derived title is exactly that);
    //   2. the cap squeezed two different parent names into one string (roots truncated to the same
    //      prefix, or chains elided to the same 5 segments); only the number can tell them apart.
    // This is not a return of the lowest-free-number rule: the start is always the sibling max + 1.
    for n in (sibling_max + 1)..=9999u32 {
        let candidate = capped_fork_title(parent, n);
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
    }
    // 9999 is only a defensive bound: reaching it means the title space is broken; fail loudly, never loop.
    Err("Fork numbers are used up for this name".into())
}


/// One suffix segment's text (without the separating space): `(fork #N)`.
///
/// Built from `FORK_MARK` minus its leading space: building and `fork_sibling_number`'s parsing share
/// the constants, since two copies of the literal would drift (the two must be exact inverses).
pub(super) fn fork_suffix_segment(number: u32) -> String {
    format!("{}{number}{FORK_MARK_END}", FORK_MARK.trim_start())
}


/// Parent name → `(root name, trailing (fork #k) suffix chain)`, chain oldest first.
///
/// `fork_sibling_number` is the only criterion; this only guesses the cut (the last `" (fork #"`)
/// and that function decides: for shapes like `(fork #x)` or `(fork #)` it returns `None` and the chain
/// stops there, so that segment stays in the root name (`A (fork #x) (fork #1)` has root `A (fork #x)`)
/// rather than being dropped as a segment. There can't be a second idea of what a suffix is: two
/// criteria for one thing inevitably judge the same suffix two ways.
pub(super) fn split_fork_suffixes(parent: &str) -> (&str, Vec<&str>) {
    let mut segments = Vec::new();
    let mut rest = parent;
    while let Some(start) = rest.rfind(FORK_MARK) {
        let head = &rest[..start];
        if fork_sibling_number(head, rest).is_none() {
            break;
        }
        // `start` sits on `FORK_MARK`'s leading space (1 byte); +1 is the `(`.
        segments.push(&rest[start + 1..]);
        rest = head;
    }
    segments.reverse();
    (rest, segments)
}


/// Strips the elision mark from the end of the root name, returning `(root name, had the mark)`.
///
/// Only a trailing `…` counts: this module only ever puts the mark between root and chain. Stripping
/// keeps forking idempotent (no `A … … (fork #…)`), and whether the mark was there must be carried
/// back, or further forks would quietly erase "earlier segments were dropped" from the name.
pub(super) fn strip_elision_marker(root: &str) -> (&str, bool) {
    let trimmed = root.trim_end();
    match trimmed.strip_suffix(FORK_ELISION_MARK) {
        Some(rest) => (rest.trim_end(), true),
        None => (trimmed, false),
    }
}


/// Builds one capped candidate title: `<root> [ … ] <suffix chain> (fork #N)`.
///
/// Both product rules live here (`next_fork_title` only picks N):
/// - Segment cap: after appending the new segment, a chain longer than 5 keeps only the newest 5,
///   drops the older ones, and puts a `…` after the root name to show the elision. The segment cap is
///   what leaves `MAX_FORK_TITLE_CHARS` a fixed floor for the root name.
/// - Character budget: the whole title is at most 80 characters (mark and full chain included); any
///   excess is absorbed by the root name. Under the segment cap the chain is at most 5 segments (about 11
///   characters each) and always fits, so only the root can be cut; `…` and the chain are a fixed tail,
///   and truncation only touches the root, or the mark would have been inserted for nothing.
///
/// A truncated root name must leave a visible `…` (the same convention as `git.rs`'s explicit marker
/// when it cuts a diff: every cut leaves a trace). `history::truncate_chars` itself is silent
/// (`chars().take(max)`), so calling only it would cut `Algebra problems (part one)` to
/// `Algebra problems`, which reads as a complete title; nobody could tell it was cut.
///
/// But when the tail already carries `…` (earlier segments were dropped) no second one is added: two
/// ellipses in one title can't say which part was left out. Then the 1 character isn't reserved either:
/// reserving it without inserting the mark would leave the string one character short of the budget
/// (79 of 80). So the reservation follows `add_marker` alone: reserve only when it is inserted.
///
/// Cuts by character (reusing `history::truncate_chars`), not by byte: titles are often CJK, and a
/// byte cut would split a character in two.
pub(super) fn capped_fork_title(parent: &str, number: u32) -> String {
    // Splitting and appending both work on the full parent name, the same string the sibling check
    // (`next_fork_title`) looks at; this only decides what the built candidate looks like.
    let (root, mut segments) = split_fork_suffixes(parent);
    let (root, had_marker) = strip_elision_marker(root);
    let new_segment = fork_suffix_segment(number);
    segments.push(new_segment.as_str());
    let elided = segments.len() > MAX_FORK_SUFFIX_SEGMENTS;
    if elided {
        // The oldest segments are dropped (`drain` from the front); the new one always stays.
        segments.drain(..segments.len() - MAX_FORK_SUFFIX_SEGMENTS);
    }
    // Whether to insert the mark: segments were dropped now, or a previous fork dropped some (the
    // parent's root ends with `…`). Both mean earlier fork segments are gone; otherwise no stray dots.
    let marker = elided || had_marker;
    // Tail = elision mark + the whole suffix chain. Build it first, then measure: the budget minus the
    // tail all goes to the root (`saturating_sub` is defensive; under the cap the tail is at most ~62 characters).
    let mut tail = String::new();
    if marker {
        tail.push(FORK_SUFFIX_SEP);
        tail.push(FORK_ELISION_MARK);
    }
    for segment in segments.iter().copied() {
        tail.push(FORK_SUFFIX_SEP);
        tail.push_str(segment);
    }
    let budget = MAX_FORK_TITLE_CHARS.saturating_sub(tail.chars().count());
    // Whether the budget cuts the root: `truncate_chars` trims before comparing lengths, so measure the
    // same way (it gives no signal itself; only the caller can tell). This depends on the budget only,
    // which is separate from whether to insert the mark, which also depends on the tail.
    let root_cut = root.trim().chars().count() > budget;
    // The root's own `…` goes in only when the root really was cut and the tail has no mark yet (two marks
    // in one title can't say which part was left out). The reserved character goes with it: reserving
    // without inserting would leave the string one character short (79 of 80).
    let add_marker = root_cut && !marker;
    let root_budget = budget.saturating_sub(usize::from(add_marker));
    let root = crate::engines::history::truncate_chars(root, root_budget);
    let root = root.trim_end();
    // When the budget squeezes the root to nothing (only possible with a person's own huge numbers) the
    // build above leaves a leading space; such a name says nothing in the sidebar, as with the empty name.
    if root.is_empty() {
        return tail.trim_start().to_string();
    }
    if add_marker {
        return format!("{root}{FORK_ELISION_MARK}{tail}");
    }
    format!("{root}{tail}")
}


/// The fork number of `name` relative to the source's current name `source_name`: `name` must equal
/// `<source_name> (fork #k)` as a whole to count as a sibling, otherwise `None`.
///
/// Never turn this into a prefix check (`name.starts_with("<source> (fork #")`): a grandchild
/// `A (fork #1) (fork #1)` also starts with `A (fork #`, so a prefix check would count grandchildren as
/// `A`'s siblings and `A`'s next fork would get `(fork #3)` instead of `(fork #2)`. The same kind of
/// "one thing, two criteria" drift, so tests pin this down
/// (`fork_numbers_do_not_count_grandchildren_as_siblings`).
pub(super) fn fork_sibling_number(source_name: &str, name: &str) -> Option<u32> {
    let digits = name
        .strip_prefix(source_name)?
        .strip_prefix(FORK_MARK)?
        .strip_suffix(FORK_MARK_END)?;
    // Empty, signed and non-ASCII numbers don't count: `from_str` takes only digits, but it accepts a
    // leading `+` (`"+1".parse::<u32>()` succeeds), and `+1` is not a shape we ever build.
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}


/// Every session's effective name for the engine (`custom_title` when non-empty, else the derived
/// title; at most one value per session).
///
/// The numbering consumes only this set: a name is the session's current identity, so the two columns
/// must first fold into one name by one rule (the one `resolve_fork_plan` uses for the source name).
/// Inserting both columns would give one session two names in the set, and a fork number left in
/// `title` would hold a number on the person's behalf (showing as `#1 → #3 → #4`).
pub(super) fn taken_titles(
    db: &crate::engines::support::db::Db,
    engine: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare("SELECT custom_title, title FROM cli_sessions WHERE engine = ?1")
        .map_err(|e| format!("Couldn't read session titles: {e}"))?;
    let rows = stmt
        .query_map([engine], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(|e| format!("Couldn't read session titles: {e}"))?;
    let mut out = std::collections::HashSet::new();
    for row in rows {
        let (custom, derived) = row.map_err(|e| format!("Couldn't read session titles: {e}"))?;
        // Each row contributes exactly one effective name, by the same rule `resolve_fork_plan` uses
        // for the source name (an empty or blank `custom_title` is not a rename).
        let name = custom
            .filter(|t| !t.trim().is_empty())
            .or(derived)
            .unwrap_or_default();
        out.insert(name);
    }
    Ok(out)
}

