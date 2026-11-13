//! What desktop-cc-gui's engine layer needs from the app around it, reduced to what Misty keeps:
//! its tables in misty.db, its event sink, its few settings, the DeepSeek Harness host, and the
//! paths it stages files in. Adapted from desktop-cc-gui (MIT, Copyright (c) 2026
//! zhukunpenglinyutong); each file names its source.

pub mod config;
pub mod db;
pub mod dsh_host;
pub mod event_sink;
pub mod files;
pub mod mcp;
pub mod open_app;
pub mod paths;
pub mod provider_files;
pub mod settings;

use std::sync::{Arc, OnceLock};

/// The engine layer's shared state, managed by the Tauri app (ccgui's `AppState`, less what Misty
/// leaves out). Every field is shared, so a clone is the same state.
#[derive(Clone)]
pub struct EngineState {
    pub db: Arc<db::Db>,
    /// Engine events, as desktop-cc-gui's wire payloads. In Misty they go to the run bridge
    /// (`engines/bridge.rs`), which turns them into the run's events; nothing reaches a webview
    /// directly.
    pub sink: Arc<event_sink::EventSink>,
    pub processes: Arc<crate::engines::ProcessRegistry>,
    pub dsh_host: Arc<dsh_host::DshHostState>,
    pub opencode_server: Arc<crate::engines::opencode_server::OpencodeServerState>,
}

static STATE: OnceLock<EngineState> = OnceLock::new();

/// The engine state, once the app has opened it.
pub fn state() -> Option<&'static EngineState> {
    STATE.get()
}

impl EngineState {
    /// Opens the engine tables in misty.db and wires the sink to `emit`.
    pub fn open(
        store: &database::store::Store,
        misty_root: &std::path::Path,
        emit: Arc<dyn event_sink::Emit>,
    ) -> Result<Self, String> {
        paths::init(misty_root);
        paths::ensure_dirs().map_err(|error| error.to_string())?;
        let db = Arc::new(db::Db::open_store(store).map_err(|error| error.to_string())?);
        db::set_global(Arc::clone(&db));
        let state = Self {
            db,
            sink: event_sink::EventSink::new(emit),
            processes: Arc::new(crate::engines::ProcessRegistry::default()),
            dsh_host: Arc::new(dsh_host::DshHostState::default()),
            opencode_server: Arc::new(
                crate::engines::opencode_server::OpencodeServerState::default(),
            ),
        };
        let _ = STATE.set(state.clone());
        Ok(state)
    }
}
