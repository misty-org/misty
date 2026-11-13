/// The embedding browser. Kiri decides *who* is calling and whether the call
/// is well formed; the host decides what the browser does about it.
pub trait Host: Send + Sync + 'static {
    /// Runs `work` on the UI thread, where OS authenticators and sheets live.
    /// The default runs it in place, for hosts without a UI thread.
    fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
        work();
    }
}
