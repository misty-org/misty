//! Reading rows as the TypeScript's zod schemas did.
use super::rows::{EvidenceKind, LedgerEvidence, LedgerRow, Needs, RowState, SentRow};
use crate::js_json::{zod_optional_string, zod_string, JsValue};

fn parse_evidence(value: &JsValue) -> Option<LedgerEvidence> {
    Some(LedgerEvidence {
        kind: EvidenceKind::parse(value.get("kind")?.as_str()?)?,
        reference: zod_string(value.get("ref")?, 1, 500)?,
        summary: zod_optional_string(value.get("summary"), 0, 500)?.unwrap_or_default(),
    })
}

/// A row's fields other than `id`.
fn parse_row_body(value: &JsValue, id: Option<String>) -> Option<SentRow> {
    let evidence = match value.get("evidence") {
        Some(evidence) => Some(parse_evidence(evidence)?),
        None => None,
    };
    let needs = match value.get("needs") {
        Some(needs) => Some(Needs::parse(needs.as_str()?)?),
        None => None,
    };
    Some(SentRow {
        id,
        requirement: zod_string(value.get("requirement")?, 1, 500)?,
        state: RowState::parse(value.get("state")?.as_str()?)?,
        evidence,
        reason: zod_optional_string(value.get("reason"), 0, 500)?,
        needs,
        hint: zod_optional_string(value.get("hint"), 0, 500)?,
    })
}

/// `ledgerInputSchema.safeParse(value)`: the rows, at least one and at most 40.
pub(crate) fn parse_ledger_input(value: &JsValue) -> Option<Vec<SentRow>> {
    let rows = value.get("rows")?.as_array()?;
    if rows.is_empty() || rows.len() > 40 {
        return None;
    }
    rows.iter().map(|row| parse_row_body(row, zod_optional_string(row.get("id"), 1, 40)?)).collect()
}

/// The rows a resume carries, each with its id, as a plain string.
pub(crate) fn parse_carried_rows(value: &JsValue) -> Option<Vec<LedgerRow>> {
    value
        .as_array()?
        .iter()
        .map(|row| {
            let id = row.get("id")?.as_str()?.to_owned();
            let sent = parse_row_body(row, Some(id.clone()))?;
            Some(LedgerRow::from_sent(sent, id))
        })
        .collect()
}
