use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, MutexGuard};

static UNBORN: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static WARMING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn held(set: &'static LazyLock<Mutex<HashSet<String>>>) -> MutexGuard<'static, HashSet<String>> {
    set.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn begin(session: &str) {
    held(&UNBORN).insert(session.to_string());
    held(&WARMING).insert(session.to_string());
}

pub(crate) fn unborn(session: &str) -> bool {
    held(&UNBORN).contains(session)
}

pub(crate) fn take_warming(session: &str) -> bool {
    held(&WARMING).remove(session)
}

pub(crate) fn born(session: &str) {
    held(&UNBORN).remove(session);
    held(&WARMING).remove(session);
}
