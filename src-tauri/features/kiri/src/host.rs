pub trait Host: Send + Sync + 'static {
    fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
        work();
    }
}
