use super::*;

#[test]
fn reads_the_engine_layers_usage_shapes() {
    assert_eq!(
        context_usage(&json!({ "total_tokens": 900, "model_context_window": 200000 })),
        (Some(900), Some(200000))
    );
    assert_eq!(
        context_usage(
            &json!({ "input_tokens": 10, "cache_read_input_tokens": 1000, "output_tokens": 5 })
        ),
        (Some(1015), None)
    );
    assert_eq!(
        context_usage(&json!({ "used": 5, "size": 10 })),
        (Some(5), Some(10))
    );
    assert_eq!(context_usage(&json!({})), (None, None));
}

#[test]
fn acp_turn_totals_size_the_context() {
    let grok = json!({ "totalTokens": 12345, "inputTokens": 12000, "outputTokens": 345 });
    assert_eq!(context_usage(&grok), (Some(12345), None));
    let omp = json!({ "totalTokens": 40300, "inputTokens": 300, "outputTokens": 200,
                      "cacheRead": 39800, "model_context_window": 128000 });
    assert_eq!(context_usage(&omp), (Some(40300), Some(128000)));
    let buckets = json!({ "inputTokens": 100, "cacheRead": 900, "cachedReadTokens": 900,
                          "outputTokens": 5 });
    assert_eq!(context_usage(&buckets), (Some(1005), None));
    assert_eq!(
        context_usage(&json!({ "used": 40300, "totalTokens": 80600 })),
        (Some(40300), None)
    );
}

#[test]
fn a_zero_token_attempt_is_not_an_unknown_size() {
    for failed in [
        json!({ "totalTokens": 0, "inputTokens": 0, "outputTokens": 0 }),
        json!({ "total_tokens": 0, "input_tokens": 0, "output_tokens": 0 }),
        json!({ "input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0 }),
    ] {
        assert_eq!(context_usage(&failed), (None, None), "{failed}");
    }
    assert_eq!(context_usage(&json!({ "used": 0 })), (Some(0), None));
}

#[test]
fn a_turn_total_is_told_apart_from_the_contexts_size() {
    assert!(values::only_turn_total(
        &json!({ "totalTokens": 80600, "inputTokens": 80000 })
    ));
    assert!(!values::only_turn_total(
        &json!({ "totalTokens": 80600, "used": 40300 })
    ));
    assert!(!values::only_turn_total(&json!({ "total_tokens": 900 })));
    assert!(!values::only_turn_total(&json!({ "totalTokens": 0 })));
}

#[test]
fn question_cards_keep_options_and_multi_select() {
    let cards = question_cards(&json!({ "questions": [
        { "question": "Which?", "header": "Pick", "multiSelect": true,
          "options": [{ "label": "A", "description": "first" }, { "label": "B" }] },
        { "question": " " },
    ]}));
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["multiSelect"], true);
    assert_eq!(cards[0]["options"][1]["label"], "B");
}

#[test]
fn failed_results_are_recognised() {
    assert!(result_failed(&json!({ "isError": true, "content": "boom" })).is_some());
    assert!(result_failed(&json!({ "success": false })).is_some());
    assert!(result_failed(&json!("ok")).is_none());
}

#[test]
fn a_result_for_a_call_never_seen_settles_no_other_row() {
    let open = |wire: Option<&str>, name: &str| OpenTool {
        wire: wire.map(str::to_string),
        name: name.to_string(),
        id: wire.unwrap_or(name).to_string(),
        started: Instant::now(),
    };
    let view = RunView {
        tools: vec![
            open(Some("toolu_lamer"), "mcp__misty__browser_navigate"),
            open(None, "mcp__misty__browser_run"),
        ],
        ..RunView::default()
    };
    assert_eq!(find_tool(&view, Some("toolu_lamer"), ""), Some(0));
    assert_eq!(find_tool(&view, Some("toolu_dior"), ""), None);
    assert_eq!(
        find_tool(&view, Some("toolu_dior"), "mcp__misty__browser_navigate"),
        None
    );
    assert_eq!(
        find_tool(&view, Some("toolu_dior"), "mcp__misty__browser_run"),
        Some(1)
    );
    assert_eq!(find_tool(&view, None, "mcp__misty__browser_run"), Some(1));
}
