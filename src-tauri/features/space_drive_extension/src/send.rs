use block2::RcBlock;
use objc2::{rc::Retained, Message};

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

pub fn block<F: ?Sized + block2::BlockFn>(handler: &block2::Block<F>) -> Sendable<RcBlock<F>> {
    Sendable(handler.copy())
}

pub fn object<T: Message>(object: &T) -> Sendable<Retained<T>> {
    Sendable(object.retain())
}

pub fn spawn(work: impl FnOnce() + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("misty-drive-ext".into())
        .spawn(work);
}
