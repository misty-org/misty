//! Objective-C objects handed to a worker thread. File Provider calls want their answer later, from
//! wherever the work finishes: completion blocks and observers may be called from any thread, but
//! `RcBlock` and `Retained` don't say so in Rust's types, so this wrapper does.
use block2::RcBlock;
use objc2::{rc::Retained, Message};

/// A block or object that may be used from another thread. Each use names why that is safe.
pub struct Sendable<T>(pub T);

// SAFETY: File Provider documents its completion handlers and enumeration observers as callable from
// any queue, and blocks copied to the heap (`RcBlock`) are retained objects whose retain count is
// atomic. Only those are wrapped (`block` and `object` below).
unsafe impl<T> Send for Sendable<T> {}

impl<T> Sendable<T> {
    pub fn into_inner(self) -> T {
        self.0
    }
}

/// A completion handler, copied off the stack so it outlives the call that handed it over.
pub fn block<F: ?Sized + block2::BlockFn>(handler: &block2::Block<F>) -> Sendable<RcBlock<F>> {
    Sendable(handler.copy())
}

/// An observer or other system object, retained for the worker that answers it.
pub fn object<T: Message>(object: &T) -> Sendable<Retained<T>> {
    Sendable(object.retain())
}

/// Runs `work` on a thread of its own: each File Provider call may wait on Misty for as long as a
/// download takes, and calls arrive concurrently.
pub fn spawn(work: impl FnOnce() + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("misty-drive-ext".into())
        .spawn(work);
}
