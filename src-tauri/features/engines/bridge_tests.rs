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
