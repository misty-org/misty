use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod desktop;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

use desktop::Keystore;

pub trait KeystoreExt<R: Runtime> {
    fn keystore(&self) -> &Keystore<R>;
}

impl<R: Runtime, T: Manager<R>> KeystoreExt<R> for T {
    fn keystore(&self) -> &Keystore<R> {
        self.state::<Keystore<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keystore")
        .invoke_handler(tauri::generate_handler![
            commands::remove,
            commands::retrieve,
            commands::store
        ])
        .setup(|app, api| {
            let keystore = desktop::init(app, api)?;
            app.manage(keystore);
            Ok(())
        })
        .build()
}
