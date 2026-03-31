use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

pub use error::{Error, Result};
pub use models::*;

mod error;
mod models;
#[cfg(target_os = "android")]
mod mobile;

#[cfg(target_os = "android")]
use mobile::DocumentTree;

#[cfg(target_os = "android")]
pub trait DocumentTreeExt<R: Runtime> {
    fn document_tree(&self) -> &DocumentTree<R>;
}

#[cfg(target_os = "android")]
impl<R: Runtime, T: Manager<R>> DocumentTreeExt<R> for T {
    fn document_tree(&self) -> &DocumentTree<R> {
        self.state::<DocumentTree<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("document-tree")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            _app.manage(mobile::init(_app, api)?);
            #[cfg(not(target_os = "android"))]
            let _ = api;
            Ok(())
        })
        .build()
}
