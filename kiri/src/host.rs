use crate::Caller;

/// The embedding browser. Kiri decides *who* is calling and whether the call
/// is well formed; the host decides what the browser does about it.
pub trait Host: Send + Sync + 'static {
    /// Whether the user has let `caller.origin` use a capability that needs
    /// permission. Hosts answer from their own site-permission store; the
    /// default refuses everything.
    fn allows(&self, _caller: &Caller, _capability: &str) -> bool {
        false
    }

    /// A one-way report from a page, e.g. that it started playing audio.
    fn signal(&self, caller: &Caller, signal: Signal);

    /// Runs `work` on the UI thread, where OS authenticators and sheets live.
    /// The default runs it in place, for hosts without a UI thread.
    fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
        work();
    }
}

/// Page state a capability reports to the host.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Signal {
    /// The page is (or stopped) audibly playing media.
    MediaAudible(bool),
}
