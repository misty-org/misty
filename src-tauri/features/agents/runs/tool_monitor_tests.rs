use futures_util::future::BoxFuture;

use super::*;
use crate::model_tools::CatalogTool;
use crate::web_search::provider::SearchProviderId;
use crate::web_search::tool::web_search_descriptor;
use crate::model_calls::RawJson;

fn tool(name: &str, read_only: bool) -> CatalogTool {
    CatalogTool {
        name: name.to_owned(),
        description: String::new(),
        input_schema: RawJson::from_text(r#"{"type":"object","properties":{}}"#.to_owned()).unwrap(),
        concurrent: false,
        read_only,
        local: false,
    }
}

fn catalog() -> Arc<ModelCatalog> {
    Arc::new(ModelCatalog::new(
        vec![tool("note.search", true), tool("note.update", false), tool("browser.workspace.interact", false), tool("browser.workspace.visual", true), tool("screen.open", true)],
        &["agent_finish"],
    ))
}

fn pages(names: &[(&str, bool)]) -> Arc<ModelCatalog> {
    Arc::new(ModelCatalog::new(names.iter().map(|(name, read_only)| tool(name, *read_only)).collect(), &["agent_finish"]))
}

#[derive(Default)]
struct Saved(Mutex<Vec<HarnessCheckpoint>>);

impl ToolCheckpoints for Saved {
    fn checkpoint(&self, event: HarnessCheckpoint) -> BoxFuture<'_, Result<(), RuntimeError>> {
        self.0.lock().unwrap().push(event);
        Box::pin(async { Ok(()) })
    }
}

struct Setup {
    order: SerialToolLifecycle,
    monitor: ToolMonitor,
    saved: Arc<Saved>,
}

fn setup_with(catalog: Arc<ModelCatalog>, rejected: &[&str]) -> Setup {
    let order = SerialToolLifecycle::new();
    let saved = Arc::new(Saved::default());
    let rejected = Arc::new(Mutex::new(rejected.iter().map(|id| (*id).to_owned()).collect()));
    let monitor = ToolMonitor::new(catalog, order.clone(), saved.clone(), rejected);
    Setup { order, monitor, saved }
}

fn setup(rejected: &[&str]) -> Setup {
    setup_with(catalog(), rejected)
}

fn json(text: &str) -> JsValue {
    JsValue::parse(text).unwrap()
}

fn tool_call(id: &str, name: &str, input: &str) -> ToolCall {
    ToolCall { tool_call_id: id.to_owned(), tool_name: name.to_owned(), input: json(input) }
}

fn ok(call: ToolCall, output: &str) -> ToolEnd {
    ToolEnd { tool_call: call, duration_ms: 1, success: true, output: Some(json(output)), error: None }
}

fn failed(call: ToolCall, error: &str) -> ToolEnd {
    ToolEnd { tool_call: call, duration_ms: 1, success: false, output: None, error: Some(RuntimeError::text(error)) }
}

impl Setup {
    async fn run(&self, end: ToolEnd) {
        self.monitor.on_start(&end.tool_call).await.unwrap();
        self.monitor.on_end(end).await.unwrap();
    }

    async fn ran(&self, id: &str, name: &str, input: &str, output: &str) {
        self.run(ok(tool_call(id, name, input), output)).await;
    }

    async fn broke(&self, id: &str, name: &str, input: &str, error: &str) {
        self.run(failed(tool_call(id, name, input), error)).await;
    }

    fn stopped(&self) -> bool {
        !self.order.stopped_reason().is_empty()
    }
}

#[test]
fn shows_the_model_mistys_tool_names_with_dots_as_underscores() {
    let catalog = catalog();
    let names: Vec<&str> = catalog.tools.iter().map(|tool| tool.model_name.as_str()).collect();
    assert_eq!(names, ["note_search", "note_update", "browser_workspace_interact", "browser_workspace_visual", "screen_open"]);
    assert_eq!(catalog.misty_name("note_update"), "note.update");
    assert!(catalog.read_only("note_search"));
    let taken = ModelCatalog::new(vec![tool("agent.finish", false)], &["agent_finish"]);
    assert_eq!(taken.tools[0].model_name, "agent_finish_2");
}

#[tokio::test]
async fn checkpoints_a_read_once_on_finish_and_a_write_on_start_and_finish() {
    let setup = setup(&[]);
    setup.ran("read", "note_search", "{}", r#"{"ok":true}"#).await;
    setup.ran("write", "note_update", "{}", r#"{"ok":true}"#).await;
    let saved: Vec<String> = setup.saved.0.lock().unwrap().iter().map(|event| format!("{}:{}", event.node_id, event.state.as_str())).collect();
    assert_eq!(saved, ["tool:read:completed", "tool:write:running", "tool:write:completed"]);
}

#[tokio::test]
async fn announces_a_search_the_device_runs_itself_and_gives_the_timeline_its_query_and_links() {
    let local = Arc::new(ModelCatalog::new(vec![web_search_descriptor(SearchProviderId::Serper)], &["agent_finish"]));
    let setup = setup_with(local, &[]);
    setup.ran("s", "web_search", r#"{"query":"tea"}"#, r#"{"results":[{"title":"Tea","url":"https://tea.example"}]}"#).await;
    let saved = setup.saved.0.lock().unwrap();
    let nodes: Vec<String> = saved.iter().map(|event| format!("{}:{}", event.node_id, event.state.as_str())).collect();
    assert_eq!(nodes, ["tool:s:running", "tool:s:completed"]);
    assert_eq!(
        saved[1].output.as_ref().unwrap().stringify(),
        r#"{"tool":"web.search","duration_ms":1,"success":true,"device_arguments":{"query":"tea"},"device_result":{"results":[{"title":"Tea","url":"https://tea.example"}]},"device_output":{"results":[{"title":"Tea","url":"https://tea.example"}]}}"#
    );
}

#[tokio::test]
async fn lets_the_model_correct_a_rejected_write_then_stops_when_it_repeats_it_unchanged() {
    let setup = setup(&["first", "second"]);
    setup.broke("first", "note_update", r#"{"id":"n1"}"#, "tool_execution_failed: pass space for this change").await;
    assert_eq!(setup.order.stopped_reason(), "");
    assert!(setup.order.resume());
    setup.broke("second", "note_update", r#"{"id":"n1"}"#, "tool_execution_failed: pass space for this change").await;
    assert!(setup.stopped());
    assert_eq!(setup.monitor.failures().len(), 1);
}

#[tokio::test]
async fn never_stops_the_run_for_a_failed_read() {
    let setup = setup(&[]);
    for id in ["a", "b", "c"] {
        setup.broke(id, "note_search", r#"{"query":"launch"}"#, "Misty's tool service is temporarily unavailable.").await;
        assert!(setup.order.resume());
    }
    assert_eq!(setup.order.stopped_reason(), "");
    assert!(setup.monitor.failures().is_empty());
}

#[tokio::test]
async fn ends_the_response_without_a_failure_when_it_hands_off_to_a_screen() {
    let setup = setup(&[]);
    setup.ran("screen", "screen_open", "{}", r#"{"status":"screen_requested","message":"Opening a browser."}"#).await;
    assert_eq!(setup.order.stopped_reason(), "Opening a browser.");
    assert_eq!(setup.monitor.handoff(), "Opening a browser.");
    assert!(setup.monitor.failures().is_empty());
}

#[tokio::test]
async fn stops_when_a_writes_outcome_is_unknown() {
    let setup = setup(&[]);
    setup.ran("send", "note_update", "{}", r#"{"status":"uncertain"}"#).await;
    assert!(setup.stopped());
    assert_eq!(setup.monitor.failures().len(), 1);
}

const UNCERTAIN: &str = r#"{"status":"uncertain"}"#;

#[tokio::test]
async fn looks_again_after_an_uncertain_page_action_but_stops_on_an_uncertain_consequential_one() {
    let names = [("browser.snapshot", true), ("browser.steps", false)];
    for (input, stops) in [
        (r#"{"steps":[{"action":"click","ref":"e4"}]}"#, false),
        (r#"{"steps":[{"action":"click","ref":"e9","allowConsequential":true}]}"#, true),
    ] {
        let setup = setup_with(pages(&names), &[]);
        setup.ran("act", "browser_steps", input, UNCERTAIN).await;
        assert_eq!(setup.stopped(), stops);
        if !stops {
            assert_eq!(setup.monitor.required_inspection(), "browser.snapshot");
        }
    }
}

#[tokio::test]
async fn looks_again_after_an_uncertain_page_goal_flagged_consequential_that_names_nothing_consequential() {
    let names = [("browser.snapshot", true), ("browser.act", false)];
    for (goal, stops) in [
        ("Create a new CryptPad document titled \\\"Best LA Maternity Hospitals\\\" and write content into it", false),
        ("Send the drafted reply to the landlord", true),
    ] {
        let setup = setup_with(pages(&names), &[]);
        setup.ran("act", "browser_act", &format!(r#"{{"goal":"{goal}","allowConsequential":true}}"#), UNCERTAIN).await;
        assert_eq!(setup.stopped(), stops);
    }
}

#[tokio::test]
async fn keeps_the_finish_while_a_look_is_required_and_one_look_satisfies_it_even_when_it_fails() {
    let setup = setup_with(pages(&[("browser.snapshot", true), ("browser.steps", false)]), &[]);
    setup.ran("act", "browser_steps", r#"{"steps":[{"action":"click","ref":"e4"}]}"#, UNCERTAIN).await;
    let all: Vec<String> = ["browser_snapshot", "browser_steps", "agent_finish"].map(str::to_owned).to_vec();
    assert_eq!(setup.monitor.active_tools(&all), ["browser_snapshot", "agent_finish"]);
    setup.order.resume();
    setup.broke("look", "browser_snapshot", "{}", "The page shows no readable content.").await;
    assert_eq!(setup.monitor.required_inspection(), "");
    assert_eq!(setup.monitor.active_tools(&all), all);
    // The look stays offered when the visible tools do not include it.
    setup.order.resume();
    setup.ran("act2", "browser_steps", r#"{"steps":[{"action":"click","ref":"e5"}]}"#, UNCERTAIN).await;
    let programs: Vec<String> = ["browser_run", "agent_finish"].map(str::to_owned).to_vec();
    assert_eq!(setup.monitor.active_tools(&programs), ["browser_snapshot", "agent_finish"]);
}

#[tokio::test]
async fn looks_again_with_a_program_after_an_uncertain_program() {
    let setup = setup_with(pages(&[("browser.run", false), ("browser.snapshot", true)]), &[]);
    setup.ran("p", "browser_run", r#"{"code":"await t.click('Next')"}"#, UNCERTAIN).await;
    assert_eq!(setup.monitor.required_inspection(), "browser.run");
    let all: Vec<String> = ["browser_run", "agent_finish"].map(str::to_owned).to_vec();
    assert_eq!(setup.monitor.active_tools(&all), all);
}

#[tokio::test]
async fn plans_around_an_own_tab_that_did_not_open_twice_but_not_the_persons_tab() {
    let setup = self::setup(&[]);
    for id in ["a", "b"] {
        setup.ran(id, "screen_open", r#"{"url":"https://depop.com/x","newTab":true}"#, UNCERTAIN).await;
        assert_eq!(setup.order.stopped_reason(), "");
        assert!(setup.order.resume());
    }
    setup.ran("c", "screen_open", r#"{"url":"https://depop.com/x"}"#, UNCERTAIN).await;
    assert!(setup.stopped());
    let person = self::setup(&[]);
    person.ran("d", "screen_open", r#"{"target":"current_tab"}"#, UNCERTAIN).await;
    assert!(person.stopped());
    assert_eq!(setup.monitor.failures().len(), 1);
}

#[tokio::test]
async fn plans_around_a_request_for_the_person_that_nobody_answered() {
    let setup = setup_with(pages(&[("browser.request_user_action", false)]), &[]);
    setup.broke("ask", "browser_request_user_action", r#"{"reason":"Cloudflare check"}"#, "The tool could not complete this action.").await;
    assert_eq!(setup.order.stopped_reason(), "");
    assert!(setup.monitor.failures().is_empty());
}

#[tokio::test]
async fn declines_the_rest_of_a_response_after_a_failure_without_running_it() {
    let setup = setup(&["write"]);
    let write = tool_call("write", "note_update", "{}");
    let queued = tool_call("queued", "note_search", "{}");
    setup.monitor.on_start(&write).await.unwrap();
    let later = tokio::spawn(setup.monitor.on_start(&queued));
    setup.monitor.on_end(failed(write, "tool_execution_failed: invalid date")).await.unwrap();
    later.await.unwrap().unwrap();
    let declined = setup.order.declined("queued").unwrap();
    assert!(declined.contains("tool_not_attempted"));
    setup.monitor.on_end(ToolEnd { duration_ms: 0, ..failed(queued, &declined) }).await.unwrap();
    assert_eq!(setup.order.stopped_reason(), "");
    assert!(setup.order.resume());
    assert_eq!(setup.order.declined("queued"), None);
}

#[tokio::test]
async fn a_stale_reference_asks_for_the_snapshot_and_counts_as_no_failure() {
    let setup = setup_with(pages(&[("browser.snapshot", true), ("browser.steps", false)]), &[]);
    let stale = r#"{"status":"failure","reason":"browser_snapshot_stale","attempted":false}"#;
    setup.ran("act", "browser_steps", "{}", stale).await;
    assert_eq!(setup.monitor.required_inspection(), "browser.snapshot");
    assert!(setup.monitor.failures().is_empty());
    assert_eq!(setup.order.stopped_reason(), "");
}

#[tokio::test]
async fn closing_a_tab_is_forgiven_eight_times() {
    let close = Arc::new(ModelCatalog::new(vec![tool("screen.close", false)], &["agent_finish"]));
    let closes = setup_with(close, &[]);
    for index in 0..8 {
        closes.broke(&format!("c{index}"), "screen_close", "{}", "boom").await;
        assert_eq!(closes.order.stopped_reason(), "");
        assert!(closes.order.resume());
    }
    closes.broke("c8", "screen_close", "{}", "boom").await;
    assert!(closes.stopped());
}
