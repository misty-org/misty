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
    // Grok 0.1's prompt `_meta` (PromptResponseMeta), as grok_acp projects it.
    let grok = json!({ "totalTokens": 12345, "inputTokens": 12000, "outputTokens": 345 });
    assert_eq!(context_usage(&grok), (Some(12345), None));
    // omp 18's prompt answer usage, with the window its usage_update gave.
    let omp = json!({ "totalTokens": 40300, "inputTokens": 300, "outputTokens": 200,
                      "cacheRead": 39800, "model_context_window": 128000 });
    assert_eq!(context_usage(&omp), (Some(40300), Some(128000)));
    // Gemini-style buckets with no total add up, each bucket once however it's spelt.
    let buckets = json!({ "inputTokens": 100, "cacheRead": 900, "cachedReadTokens": 900,
                          "outputTokens": 5 });
    assert_eq!(context_usage(&buckets), (Some(1005), None));
    // An explicit size wins over the turn total that came with it.
    assert_eq!(
        context_usage(&json!({ "used": 40300, "totalTokens": 80600 })),
        (Some(40300), None)
    );
}

#[test]
fn a_zero_token_attempt_is_not_an_unknown_size() {
    // A failed attempt before a retry reports zeros in every spelling.
    for failed in [
        json!({ "totalTokens": 0, "inputTokens": 0, "outputTokens": 0 }),
        json!({ "total_tokens": 0, "input_tokens": 0, "output_tokens": 0 }),
        json!({ "input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0 }),
    ] {
        assert_eq!(context_usage(&failed), (None, None), "{failed}");
    }
    // Only an explicit `used: 0` (a compaction the engine didn't size) clears the bar.
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
