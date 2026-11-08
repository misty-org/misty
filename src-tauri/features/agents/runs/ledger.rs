//! The requirements ledger. A run with several parts keeps one row per
//! part. A part is done only with evidence that outlives the model's say-so: a page it kept, a note
//! or file it wrote, or a receipt a tool returned. A resume carries the ledger, so the parts that
//! passed are not done again.
mod parse;
mod rows;

use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

#[allow(unused_imports)]
pub(crate) use parse::{parse_carried_rows, parse_ledger_input};
#[allow(unused_imports)]
pub(crate) use rows::{ledger_input_schema, EvidenceKind, LedgerEvidence, LedgerRow, Needs, RowField, RowState, SentRow};

use super::{
    js_json::JsValue,
    js_regex::js_regex,
    task_completion::{Outcome, RemainingItem, TaskCompletion},
    text::{js_len, js_prefix, js_trim},
    transcript::{tool_parts, ToolPart},
    transcript_json::{stringify_output, stringify_raw},
};
use crate::model_calls::Message;

pub(crate) const LEDGER_TOOL: &str = "agent_ledger";

pub(crate) const LEDGER_INSTRUCTIONS: &str = concat!(
    "When a request has several parts, call agent_ledger early with one row per part (state pending), and again as each part ends: ",
    "done with evidence (a kept page's address, a note or file you wrote, or a receipt a tool returned), or failed, blocked or skipped with a reason. ",
    "Say needs: input when only the person can supply something, takeover for a captcha or sign-in. ",
    "Rows from an earlier attempt that are already done stay done: don't redo them. Work only the open rows."
);

const MARKER: &str = "<!--misty-ledger:";

/// The rows a run keeps, in order, updated by id or requirement.
#[derive(Clone, Debug, Default)]
pub(crate) struct Ledger {
    rows: Vec<LedgerRow>,
}

impl Ledger {
    pub(crate) fn new(seed: Vec<LedgerRow>) -> Self {
        let rows = seed
            .into_iter()
            .map(|mut row| {
                row.carried = row.state == RowState::Done;
                row
            })
            .collect();
        Self { rows }
    }

    /// A saved ledger coming back after a restart, its rows exactly as they were.
    pub(crate) fn restored(rows: Vec<LedgerRow>) -> Self {
        Self { rows }
    }

    pub(crate) fn size(&self) -> usize {
        self.rows.len()
    }

    pub(crate) fn snapshot(&self) -> Vec<LedgerRow> {
        self.rows.clone()
    }

    pub(crate) fn update(&mut self, sent: Vec<SentRow>) -> Vec<LedgerRow> {
        for row in sent {
            let found = self.rows.iter_mut().find(|known| row.matches(known));
            match found {
                Some(known) => known.apply(row),
                None => {
                    let id = format!("r{}", self.rows.len() + 1);
                    self.rows.push(LedgerRow::from_sent(row, id));
                }
            }
        }
        self.snapshot()
    }

    /// Marks every row with evidence the run's own calls do not show as pending again. Returns them.
    /// `answer` is the finish's summary: a row whose evidence is the answer itself (the comparison,
    /// the recommendation) is backed by a written answer.
    pub(crate) fn reconcile(&mut self, messages: &[Message], answer: &str) -> Vec<LedgerRow> {
        let shown = tool_text(messages);
        let answer_written = js_len(js_trim(answer)) >= 200;
        let mut unbacked = Vec::new();
        for row in &mut self.rows {
            if row.state != RowState::Done || row.carried || backed(row.evidence.as_ref(), &shown) {
                continue;
            }
            let answers = row.evidence.as_ref().is_some_and(|evidence| evidence.kind == EvidenceKind::Note && ANSWER_EVIDENCE.is_match(&evidence.reference));
            if answers && answer_written {
                continue;
            }
            row.state = RowState::Pending;
            row.set_reason("Marked done without evidence this run shows.".to_owned());
            unbacked.push(row.clone());
        }
        unbacked
    }

    /// What is not finished, as the report lists it.
    pub(crate) fn remaining(&self) -> Vec<RemainingItem> {
        self.rows
            .iter()
            .filter(|row| row.state != RowState::Done && row.state != RowState::Skipped)
            .map(|row| RemainingItem {
                requirement: row.requirement.clone(),
                reason: match row.reason.as_deref() {
                    Some(reason) if !reason.is_empty() => reason.to_owned(),
                    _ if row.state == RowState::Pending => "Not done yet.".to_owned(),
                    _ => row.state.label().to_owned(),
                },
            })
            .collect()
    }
}

/// Records sent rows, except a part marked done without evidence: a known row keeps its state (and a
/// done row its evidence), a new one starts pending, and the caller is told which, so the run
/// supplies evidence now rather than learning at the finish that its run reads as partial. Returns
/// the rows and the ones missing evidence.
pub(crate) fn record_rows(ledger: &mut Ledger, sent: Vec<SentRow>) -> (Vec<LedgerRow>, Vec<SentRow>) {
    let known = ledger.snapshot();
    let lacks_evidence = |row: &SentRow| row.state == RowState::Done && row.evidence.is_none();
    let missing: Vec<SentRow> = sent.iter().filter(|row| lacks_evidence(row)).cloned().collect();
    let accepted = sent
        .into_iter()
        .filter_map(|mut row| {
            if !lacks_evidence(&row) {
                return Some(row);
            }
            if known.iter().any(|item| row.matches(item)) {
                return None;
            }
            row.state = RowState::Pending;
            Some(row)
        })
        .collect();
    (ledger.update(accepted), missing)
}

/// Evidence that points at the run's own answer ("the final answer below").
static ANSWER_EVIDENCE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(final )?(answer|summary|response|reply|comparison)\b", true));
static ADDRESSES: LazyLock<Regex> = LazyLock::new(|| js_regex(r#"https?:\/\/[^\s;,)"']+"#, false));
static ADDRESS_END: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[/.]+$", false));
static ADDRESS_START: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^https?:\/\/(www\.)?", false));
static WORDS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[a-z0-9][a-z0-9'-]{3,}", false));

/// Whether an evidence ref appears in what this run's tools were called with or returned. A ref that
/// names addresses among other words ("<url> scrolled to Gold Package; <url> kept") is backed when
/// one of its addresses is: models write their evidence as a sentence, not one bare string.
pub(crate) fn backed(evidence: Option<&LedgerEvidence>, shown: &str) -> bool {
    let Some(evidence) = evidence else {
        return false;
    };
    let reference = evidence.reference.to_lowercase();
    // Tool results arrive as JSON text, where & in an address reads \u0026.
    let shown = shown.replace("\\u0026", "&");
    if shown.contains(&reference) {
        return true;
    }
    let addresses: Vec<&str> = ADDRESSES.find_iter(&reference).map(|found| found.as_str()).collect();
    if !addresses.is_empty() {
        return addresses.iter().any(|address| {
            let bare = ADDRESS_END.replace(address, "");
            let bare = ADDRESS_START.replace(&bare, "");
            js_len(&bare) > 8 && shown.contains(bare.as_ref())
        });
    }
    // A described source ("Apple Support Communities threads; Reddit r/HomeKit") is backed when most
    // of its words came back from this run's tools, as search results or page text.
    let mut seen = HashSet::new();
    let words: Vec<&str> = WORDS.find_iter(&reference).map(|found| found.as_str()).filter(|word| seen.insert(*word)).collect();
    let shown_words = words.iter().filter(|word| shown.contains(**word)).count();
    words.len() >= 2 && shown_words as f64 >= (words.len() as f64 * 0.6).ceil()
}

/// Tool calls and results as lower-case text, leaving out the ledger's own calls.
fn tool_text(messages: &[Message]) -> String {
    let parts: Vec<String> = tool_parts(messages)
        .filter_map(|part| match part {
            ToolPart::Call { name, input, .. } if name != LEDGER_TOOL => Some(stringify_raw(input)),
            ToolPart::Result(result) if result.tool_name != LEDGER_TOOL => Some(stringify_output(&result.output)),
            _ => None,
        })
        .collect();
    parts.join("\n").to_lowercase()
}

/// The report for a run with a ledger: its rows decide what remains and whether it completed.
pub(crate) fn with_ledger(report: &TaskCompletion, ledger: &Ledger) -> TaskCompletion {
    if ledger.size() == 0 {
        return report.clone();
    }
    let mut open = ledger.remaining();
    let extra: Vec<RemainingItem> = report.remaining.iter().filter(|item| !open.iter().any(|row| row.requirement == item.requirement)).cloned().collect();
    open.extend(extra);
    let outcome = if !open.is_empty() && report.outcome == Outcome::Completed { Outcome::Partial } else { report.outcome };
    TaskCompletion { outcome, summary: report.summary.clone(), remaining: open }
}

/// The text a finished run ends with: the report, then its ledger for the app to read.
pub(crate) fn ledger_suffix(ledger: &Ledger) -> String {
    if ledger.size() == 0 {
        return String::new();
    }
    let rows = JsValue::Array(ledger.rows.iter().map(LedgerRow::to_js).collect());
    format!("\n\n{MARKER}{}-->", rows.stringify().replace('<', "\\u003c"))
}

/// The ledger a resume turn carries in its prompt, or none.
pub(crate) fn ledger_from_prompt(prompt: &str) -> Vec<LedgerRow> {
    let Some(start) = prompt.find(MARKER) else {
        return Vec::new();
    };
    let body = &prompt[start + MARKER.len()..];
    // The search starts at the marker, which holds no "-->" of its own.
    let Some(end) = body.find("-->") else {
        return Vec::new();
    };
    JsValue::parse(&body[..end]).and_then(|value| parse::parse_carried_rows(&value)).unwrap_or_default()
}

fn quoted_requirements<'a>(requirements: impl Iterator<Item = &'a str>) -> String {
    requirements.map(|requirement| format!("\"{}\"", js_prefix(requirement, 80))).collect::<Vec<_>>().join("; ")
}

/// The finish issue for rows marked done that nothing in the run backs.
pub(crate) fn ledger_issue(unbacked: &[LedgerRow]) -> Option<String> {
    if unbacked.is_empty() {
        return None;
    }
    let list = quoted_requirements(unbacked.iter().map(|row| row.requirement.as_str()));
    Some(format!(
        "These parts are marked done but nothing this run did shows it ({list}). Do each, or give it evidence with {LEDGER_TOOL}: the address of a page you kept, a note or file you wrote, or a receipt a tool returned. If a part could not be done, mark it failed or blocked with the reason."
    ))
}

/// A finish that says completed while its ledger still lists open parts: the report would read as
/// unfinished ([`with_ledger`]), so the run closes each row first, done with evidence or why not.
pub(crate) fn open_rows_issue(report: &TaskCompletion, open: &[RemainingItem]) -> Option<String> {
    if report.outcome != Outcome::Completed || open.is_empty() {
        return None;
    }
    let count = open.len();
    let plural = if count == 1 { "" } else { "s" };
    let list = quoted_requirements(open.iter().map(|row| row.requirement.as_str()));
    Some(format!(
        "Your {LEDGER_TOOL} list still shows {count} part{plural} as not done ({list}). Update it in one {LEDGER_TOOL} call: each part you did is done with its evidence (a kept page's address, a note you wrote, or a tool's receipt), and each you could not do is failed or skipped with the reason. Then finish."
    ))
}

#[cfg(test)]
mod tests;
