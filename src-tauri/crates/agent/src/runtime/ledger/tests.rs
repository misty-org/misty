use super::*;
use crate::runtime::transcript::fixtures::call_message;

fn sent(requirement: &str, state: RowState) -> SentRow {
    SentRow { requirement: requirement.to_owned(), state, ..SentRow::default() }
}

fn evidence(kind: EvidenceKind, reference: &str) -> LedgerEvidence {
    LedgerEvidence { kind, reference: reference.to_owned(), summary: String::new() }
}

fn requirements(rows: &[LedgerRow]) -> Vec<&str> {
    rows.iter().map(|row| row.requirement.as_str()).collect()
}

#[test]
fn sends_a_done_row_without_evidence_back_to_pending() {
    let mut ledger = Ledger::default();
    ledger.update(vec![
        SentRow { evidence: Some(evidence(EvidenceKind::Tab, "https://a.example")), ..sent("Open site A", RowState::Done) },
        sent("Open site B", RowState::Done),
    ]);
    let unbacked = ledger.reconcile(&[call_message("c", "browser_open", r#"{"url":"https://a.example/page"}"#)], "");
    assert_eq!(requirements(&unbacked), ["Open site B"]);
    assert_eq!(ledger.remaining().iter().map(|item| item.requirement.as_str()).collect::<Vec<_>>(), ["Open site B"]);
}

#[test]
fn keeps_a_carried_done_row_without_re_checking_its_evidence() {
    let row = LedgerRow::from_sent(
        SentRow { id: Some("r1".to_owned()), evidence: Some(evidence(EvidenceKind::Note, "note-1")), ..sent("A", RowState::Done) },
        "r1".to_owned(),
    );
    let mut ledger = Ledger::new(vec![row]);
    assert!(ledger.reconcile(&[], "").is_empty());
    assert!(ledger.remaining().is_empty());
}

#[test]
fn makes_a_completed_report_partial_while_a_row_is_open() {
    let mut ledger = Ledger::default();
    ledger.update(vec![SentRow { reason: Some("captcha".to_owned()), ..sent("A", RowState::Failed) }]);
    let report = with_ledger(&TaskCompletion { outcome: Outcome::Completed, summary: "ok".to_owned(), remaining: Vec::new() }, &ledger);
    assert_eq!(report.outcome, Outcome::Partial);
    assert_eq!(report.remaining, [RemainingItem { requirement: "A".to_owned(), reason: "captcha".to_owned() }]);
}

#[test]
fn round_trips_through_the_text_a_run_ends_with() {
    let mut ledger = Ledger::default();
    ledger.update(vec![SentRow { reason: Some("captcha".to_owned()), needs: Some(Needs::Takeover), ..sent("A <b>", RowState::Failed) }]);
    let suffix = ledger_suffix(&ledger);
    assert_eq!(suffix, "\n\n<!--misty-ledger:[{\"requirement\":\"A \\u003cb>\",\"state\":\"failed\",\"reason\":\"captcha\",\"needs\":\"takeover\",\"id\":\"r1\"}]-->");
    let rows = ledger_from_prompt(&format!("Continue.\n{suffix}"));
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].requirement, "A <b>");
    assert_eq!(rows[0].needs, Some(Needs::Takeover));
}

#[test]
fn a_prompt_without_a_good_ledger_carries_nothing() {
    assert!(ledger_from_prompt("Continue.").is_empty());
    assert!(ledger_from_prompt("<!--misty-ledger:[]").is_empty());
    assert!(ledger_from_prompt("<!--misty-ledger:{nope-->").is_empty());
    assert!(ledger_from_prompt(r#"<!--misty-ledger:[{"requirement":"A","state":"done"}]-->"#).is_empty());
}

#[test]
fn backs_evidence_written_as_a_sentence_around_an_address_and_answer_rows_with_the_answer() {
    let shown = r#"{"tabs":[{"url":"https://stockeldpark.co.uk/plan-your-day/tickets-prices/christmas-ticket-options/"}]}"#.to_lowercase();
    let tab = |reference: &str| evidence(EvidenceKind::Tab, reference);
    assert!(backed(Some(&tab("https://stockeldpark.co.uk/plan-your-day/tickets-prices/christmas-ticket-options/ scrolled to Gold Package; kept()")), &shown));
    assert!(!backed(Some(&tab("https://www.yorkmaze.com/plan-a-visit/ kept")), &shown));
    let searched = r#"{"results":[{"title":"HomePod plays Apple Music - Apple Support Communities","url":"https://discussions.apple.com/x?a=1&b=2"},{"title":"r/HomeKit on Reddit"}]}"#.to_lowercase();
    assert!(backed(Some(&evidence(EvidenceKind::Note, "Apple Support Communities discussion threads; Reddit r/HomeKit")), &searched));
    assert!(!backed(Some(&evidence(EvidenceKind::Note, "Consumer Reports review of speakers")), &searched));
    let mut ledger = Ledger::default();
    ledger.update(vec![SentRow { evidence: Some(evidence(EvidenceKind::Note, "Final answer text below with comparison")), ..sent("Compare the two", RowState::Done) }]);
    assert!(ledger.reconcile(&[], &"x".repeat(250)).is_empty());
    assert_eq!(ledger.reconcile(&[], "").len(), 1);
}

#[test]
fn keeps_a_part_done_without_evidence_out_of_done_and_tells_the_run() {
    let mut ledger = Ledger::default();
    record_rows(&mut ledger, vec![SentRow { evidence: Some(evidence(EvidenceKind::Tab, "https://a.test")), ..sent("Read A", RowState::Done) }]);
    let (rows, missing) = record_rows(&mut ledger, vec![sent("Read A", RowState::Done), sent("Read B", RowState::Done)]);
    assert_eq!(missing.iter().map(|row| row.requirement.as_str()).collect::<Vec<_>>(), ["Read A", "Read B"]);
    let find = |name: &str| rows.iter().find(|row| row.requirement == name).unwrap();
    assert_eq!(find("Read A").state, RowState::Done);
    assert_eq!(find("Read A").evidence.as_ref().unwrap().reference, "https://a.test");
    assert_eq!(find("Read B").state, RowState::Pending);
}

#[test]
fn a_carried_row_the_run_reopens_needs_new_evidence() {
    let row = LedgerRow::from_sent(SentRow { id: Some("r1".to_owned()), evidence: Some(evidence(EvidenceKind::Note, "note-1")), ..sent("A", RowState::Done) }, "r1".to_owned());
    let mut ledger = Ledger::new(vec![row]);
    ledger.update(vec![SentRow { id: Some("r1".to_owned()), ..sent("A", RowState::Pending) }]);
    ledger.update(vec![SentRow { id: Some("r1".to_owned()), ..sent("A", RowState::Done) }]);
    assert_eq!(ledger.reconcile(&[], "").len(), 1);
}

#[test]
fn an_update_keeps_what_it_did_not_send_and_the_order_fields_came_in() {
    let mut ledger = Ledger::default();
    ledger.update(vec![sent("A", RowState::Pending)]);
    ledger.update(vec![SentRow { reason: Some("why".to_owned()), hint: Some("use this".to_owned()), ..sent("A", RowState::Blocked) }]);
    let rows = ledger.update(vec![sent("A", RowState::Failed)]);
    assert_eq!(rows[0].reason.as_deref(), Some("why"));
    assert_eq!(rows[0].hint.as_deref(), Some("use this"));
    assert_eq!(rows[0].to_js().stringify(), r#"{"requirement":"A","state":"failed","id":"r1","reason":"why","hint":"use this"}"#);
}

#[test]
fn reads_rows_as_the_schema_does() {
    let parse = |text: &str| parse_ledger_input(&JsValue::parse(text).unwrap());
    let rows = parse(r#"{"rows":[{"id":" a ","requirement":" Do it ","state":"done","evidence":{"kind":"tab","ref":"x"}}]}"#).unwrap();
    assert_eq!(rows[0].id.as_deref(), Some("a"));
    assert_eq!(rows[0].requirement, "Do it");
    assert_eq!(rows[0].evidence.as_ref().unwrap().summary, "");
    assert_eq!(parse(r#"{"rows":[]}"#), None);
    assert_eq!(parse(r#"{"rows":[{"requirement":"a","state":"nope"}]}"#), None);
    assert_eq!(parse(r#"{"rows":[{"requirement":"a","state":"done","reason":null}]}"#), None);
    assert!(ledger_input_schema().get().starts_with(r#"{"$schema":"#));
}
