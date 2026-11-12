//! What Linux gives Misty's desktop features: the X server's pointer and front window, overlay
//! windows above everything, whether the session is Wayland, and desktop control.
pub mod control;
pub(crate) mod overlay;
pub(crate) mod x11;

pub(crate) use overlay::wayland_session;
