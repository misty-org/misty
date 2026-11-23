use futures_util::future::BoxFuture;
use serde_json::Value;

use super::{js_json::JsValue, tool_execution::ToolExecutionResponse};

#[derive(Clone, Debug, PartialEq)]
pub struct LocalToolCall {
    pub run_id: String,
    pub call_id: String,
    pub turn: i64,
    pub name: String,
    pub input: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LocalToolOutcome {
    Result(Value),
    Rejected { code: String, message: String },
}

pub trait LocalToolHost: Send + Sync {
    fn runs(&self, name: &str) -> bool;
    fn call<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, LocalToolOutcome>;
    fn check<'a>(&'a self, _call: LocalToolCall) -> BoxFuture<'a, Option<LocalToolOutcome>> {
        Box::pin(async { None })
    }
}

fn response_of(outcome: LocalToolOutcome) -> ToolExecutionResponse {
    match outcome {
        LocalToolOutcome::Result(value) => match JsValue::parse(&value.to_string()) {
            Some(value) => ToolExecutionResponse::result(value),
            None => ToolExecutionResponse::tool_error(
                "invalid_tool_outcome",
                "The tool returned an unreadable result.",
            ),
        },
        LocalToolOutcome::Rejected { code, message } => {
            ToolExecutionResponse::tool_error(&code, &message)
        }
    }
}

pub(crate) async fn run_local_tool(
    host: &dyn LocalToolHost,
    run_id: &str,
    call_id: &str,
    turn: i64,
    name: &str,
    input: &JsValue,
) -> ToolExecutionResponse {
    let Ok(input) = serde_json::from_str::<Value>(&input.stringify()) else {
        return ToolExecutionResponse::tool_error(
            "invalid_tool_input",
            "The tool's input could not be read.",
        );
    };
    response_of(
        host.call(LocalToolCall {
            run_id: run_id.to_owned(),
            call_id: call_id.to_owned(),
            turn,
            name: name.to_owned(),
            input,
        })
        .await,
    )
}

pub(crate) async fn check_crate_tool(
    host: &dyn LocalToolHost,
    run_id: &str,
    call_id: &str,
    turn: i64,
    name: &str,
    input: &JsValue,
) -> Option<ToolExecutionResponse> {
    let input = serde_json::from_str::<Value>(&input.stringify()).unwrap_or(Value::Null);
    host.check(LocalToolCall {
        run_id: run_id.to_owned(),
        call_id: call_id.to_owned(),
        turn,
        name: name.to_owned(),
        input,
    })
    .await
    .map(response_of)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::json;

    use super::*;
    use crate::control_plane::RuntimeIdentity;
    use crate::device_hooks::DeviceHooks;
    use crate::logger::Logger;
    use crate::model_tools::CatalogTool;
    use crate::runtime_errors::RuntimeError;
    use crate::tool_calls::{execute_tool, CallEnvironment, SavedWait, ToolCallDeps};
    use crate::tool_gateway::{GatewayCall, ToolGateway};

    struct Host {
        calls: Mutex<Vec<LocalToolCall>>,
        outcome: LocalToolOutcome,
    }

    impl LocalToolHost for Host {
        fn runs(&self, name: &str) -> bool {
            name.starts_with("browser.")
        }

        fn call<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, LocalToolOutcome> {
            self.calls.lock().unwrap().push(call);
            let outcome = self.outcome.clone();
            Box::pin(async move { outcome })
        }
    }

    struct Server {
        called: Mutex<Vec<String>>,
    }

    impl ToolGateway for Server {
        fn discover<'a>(
            &'a self,
            _identity: &'a RuntimeIdentity,
        ) -> BoxFuture<'a, Result<Vec<CatalogTool>, RuntimeError>> {
            Box::pin(async { Ok(Vec::new()) })
        }

        fn call<'a>(
            &'a self,
            call: GatewayCall<'a>,
        ) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>> {
            self.called.lock().unwrap().push(call.name.to_owned());
            Box::pin(async {
                Ok(ToolExecutionResponse::result(
                    JsValue::parse(r#"{"from":"server"}"#).unwrap(),
                ))
            })
        }
    }

    struct Environment;

    impl CallEnvironment for Environment {
        fn waiting<'a>(
            &'a self,
            _call_id: &'a str,
            _wait: Option<SavedWait>,
        ) -> BoxFuture<'a, Result<(), RuntimeError>> {
            Box::pin(async { Ok(()) })
        }
    }

    async fn run(host: &Host, server: &Server, name: &str) -> Result<JsValue, RuntimeError> {
        let identity = RuntimeIdentity {
            misty_run_id: "run".into(),
            runtime_run_id: "w".into(),
        };
        let hooks = Arc::new(DeviceHooks::default());
        let logger = Logger::default();
        let deps = ToolCallDeps {
            identity: &identity,
            gateway: server,
            local: Some(host),
            turn: 0,
            hooks: &hooks,
            environment: &Environment,
            logger: &logger,
        };
        execute_tool(
            &deps,
            "call-1",
            name,
            &JsValue::parse(r#"{"scopeId":"tab-12345"}"#).unwrap(),
            None,
        )
        .await
    }

    #[tokio::test]
    async fn a_tool_this_computer_runs_never_reaches_the_server() {
        let host = Host {
            calls: Mutex::default(),
            outcome: LocalToolOutcome::Result(json!({ "ok": true })),
        };
        let server = Server {
            called: Mutex::default(),
        };
        let result = run(&host, &server, "browser.snapshot").await.unwrap();
        assert_eq!(result.stringify(), r#"{"ok":true}"#);
        assert!(server.called.lock().unwrap().is_empty());
        let calls = host.calls.lock().unwrap();
        assert_eq!(
            calls[0],
            LocalToolCall {
                run_id: "run".into(),
                call_id: "call-1".into(),
                turn: 0,
                name: "browser.snapshot".into(),
                input: json!({ "scopeId": "tab-12345" })
            }
        );
    }

    #[tokio::test]
    async fn any_other_tool_still_goes_to_the_gateway() {
        let host = Host {
            calls: Mutex::default(),
            outcome: LocalToolOutcome::Result(json!({})),
        };
        let server = Server {
            called: Mutex::default(),
        };
        let result = run(&host, &server, "file.read").await.unwrap();
        assert_eq!(result.stringify(), r#"{"from":"server"}"#);
        assert!(host.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_rejected_call_is_rejected_without_effect() {
        let host = Host {
            calls: Mutex::default(),
            outcome: LocalToolOutcome::Rejected {
                code: "browser_tab_closed".into(),
                message: "That tab closed.".into(),
            },
        };
        let server = Server {
            called: Mutex::default(),
        };
        let error = run(&host, &server, "browser.snapshot").await.unwrap_err();
        assert!(
            matches!(error, RuntimeError::ToolRejected { ref code, .. } if code == "browser_tab_closed")
        );
    }

    #[tokio::test]
    async fn an_uncertain_result_keeps_its_status_for_the_loop() {
        let host = Host {
            calls: Mutex::default(),
            outcome: LocalToolOutcome::Result(
                json!({ "status": "uncertain", "message": "It may have happened." }),
            ),
        };
        let server = Server {
            called: Mutex::default(),
        };
        let result = run(&host, &server, "browser.run").await.unwrap();
        assert_eq!(
            result.get("status").and_then(JsValue::as_str),
            Some("uncertain")
        );
    }
}
