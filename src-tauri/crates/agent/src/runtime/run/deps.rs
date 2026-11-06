//! What a run needs from the app and the network, behind small interfaces so the loop can be tested
//! without either.
use std::sync::Arc;

use futures_util::future::BoxFuture;

use crate::{
    runtime::{
        agent_api::ToolHook,
        control_plane::ControlPlane,
        device::{embed_call, DeviceCalls, DeviceModels, DeviceRole, EmbedCall},
        device_hooks::DeviceHooks,
        device_models::DeviceModelStore,
        instance_model::{WatchedModel, STREAM_STALL_MS},
        logger::Logger,
        mcp_runtime::McpGateway,
        model_access::{Generated, ModelAccess},
        web_search::{
            provider::SearchProviderId,
            search_step::{DeviceSearch, SearchEndpoints, WebSearchCache},
        },
    },
    sdk::{generate_text, prepare_call, resolve_model, start_stream, CallOptions, GenerateSettings, ModelError, ModelStream},
};

use super::store::RunStore;

/// How long a memory search's query vector is, as the server expects.
const QUERY_DIMENSIONS: u32 = 768;

/// The device's choices and the calls a run makes on its fast and embedding models.
pub(crate) trait RunDevice: Send + Sync {
    fn model_id(&self, role: DeviceRole) -> Option<String>;
    fn reasoning(&self) -> String;
    fn search(&self) -> Option<DeviceSearch>;
    fn search_provider(&self) -> Option<SearchProviderId> {
        self.search().map(|saved| saved.provider)
    }
    fn title_for<'a>(&'a self, message: &'a str, reply: &'a str) -> BoxFuture<'a, Result<String, String>>;
    fn summary_for<'a>(&'a self, previous: &'a str, turns: &'a str) -> BoxFuture<'a, Result<String, String>>;
    fn embed_query<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Option<(String, Vec<f64>)>>;
}

/// A run's main model call: on the device's key, with the SDK's retries around starting the stream.
pub(crate) trait TurnModels: Send + Sync {
    fn stream<'a>(&'a self, model_id: &'a str, options: CallOptions, max_retries: u32, watch: bool) -> BoxFuture<'a, Result<ModelStream, ModelError>>;
}

/// Runs model turns on the device's keys. The key is read for each try and dropped when it returns.
pub(crate) struct DeviceTurnModels {
    pub(crate) models: Arc<DeviceModelStore>,
    pub(crate) http: reqwest::Client,
}

impl TurnModels for DeviceTurnModels {
    fn stream<'a>(&'a self, model_id: &'a str, options: CallOptions, max_retries: u32, watch: bool) -> BoxFuture<'a, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            // The SDK tidies the prompt first, and only then does a provider's own adjustment.
            let options = prepare_call(options)?;
            let route = self.models.route(model_id)?;
            let (model, options) = resolve_model(model_id, options, &route, &self.http)?;
            if watch {
                let watched = WatchedModel { inner: model, stall_ms: STREAM_STALL_MS };
                start_stream(&watched, options, Some(max_retries)).await
            } else {
                start_stream(model.as_ref(), options, Some(max_retries)).await
            }
        })
    }
}

/// The single calls made outside a run's turns, each `maxRetries: 1` and inside a step of its own.
pub(crate) struct DeviceModelAccess {
    pub(crate) models: Arc<DeviceModelStore>,
    pub(crate) http: reqwest::Client,
}

impl ModelAccess for DeviceModelAccess {
    fn generate(&self, model_id: &str, options: CallOptions) -> BoxFuture<'_, Result<Generated, ModelError>> {
        let model_id = model_id.to_owned();
        Box::pin(async move {
            let mut tries = 0;
            loop {
                tries += 1;
                match self.generate_once(&model_id, options.clone()).await {
                    Ok(turn) => return Ok(turn),
                    Err(error) if tries > super::step::DEFAULT_STEP_RETRIES => return Err(error),
                    Err(_) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
                }
            }
        })
    }
}

impl DeviceModelAccess {
    async fn generate_once(&self, model_id: &str, options: CallOptions) -> Result<Generated, ModelError> {
        let route = self.models.route(model_id)?;
        let (model, options) = resolve_model(model_id, options, &route, &self.http)?;
        let settings = GenerateSettings { max_retries: Some(1), ..GenerateSettings::default() };
        Ok(generate_text(model.as_ref(), options, settings).await?.turn)
    }
}

pub(crate) struct DesktopDevice {
    pub(crate) models: Arc<DeviceModelStore>,
    pub(crate) calls: DeviceCalls,
}

impl RunDevice for DesktopDevice {
    fn model_id(&self, role: DeviceRole) -> Option<String> {
        self.models.model_id(role)
    }

    fn reasoning(&self) -> String {
        self.models.reasoning()
    }

    fn search(&self) -> Option<DeviceSearch> {
        self.models.search()
    }

    fn title_for<'a>(&'a self, message: &'a str, reply: &'a str) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async move { self.calls.title_for(message, reply).await.map_err(|_| String::new()) })
    }

    fn summary_for<'a>(&'a self, previous: &'a str, turns: &'a str) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async move { self.calls.summary_for(previous, turns).await.map_err(|_| String::new()) })
    }

    fn embed_query<'a>(&'a self, query: &'a str) -> BoxFuture<'a, Option<(String, Vec<f64>)>> {
        Box::pin(async move {
            let (model, route) = self.calls.on_device(DeviceRole::Embedding).ok()?;
            let values = [query.to_owned()];
            let call = EmbedCall { route: &route, model: &model, values: &values, dimensions: Some(QUERY_DIMENSIONS), images: None };
            let vector = embed_call(&self.calls.client, call).await.ok()?.into_iter().next()?;
            (vector.len() == QUERY_DIMENSIONS as usize).then_some((model, vector))
        })
    }
}

pub(crate) type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub(crate) struct RunDeps {
    pub(crate) control: Arc<dyn ControlPlane>,
    pub(crate) gateway: Arc<dyn McpGateway>,
    pub(crate) models: Arc<dyn TurnModels>,
    pub(crate) access: Arc<dyn ModelAccess>,
    pub(crate) device: Arc<dyn RunDevice>,
    pub(crate) hooks: Arc<DeviceHooks>,
    pub(crate) store: Arc<RunStore>,
    pub(crate) logger: Logger,
    pub(crate) http: reqwest::Client,
    pub(crate) search_cache: WebSearchCache,
    pub(crate) search_endpoints: SearchEndpoints,
    pub(crate) clock: Clock,
    pub(crate) before_tool: Option<ToolHook>,
}
