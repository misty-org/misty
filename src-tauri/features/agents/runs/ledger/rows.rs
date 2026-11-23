use crate::js_json::JsValue;
use crate::model_calls::RawJson;

const INPUT_SCHEMA: &str = r##"{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"rows":{"minItems":1,"maxItems":40,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":40},"requirement":{"type":"string","minLength":1,"maxLength":500},"state":{"type":"string","enum":["pending","done","failed","blocked","skipped"]},"evidence":{"type":"object","properties":{"kind":{"type":"string","enum":["tab","note","file","receipt"]},"ref":{"type":"string","minLength":1,"maxLength":500},"summary":{"default":"","type":"string","maxLength":500}},"required":["kind","ref"],"additionalProperties":false},"reason":{"type":"string","maxLength":500},"needs":{"type":"string","enum":["none","input","takeover"]},"hint":{"type":"string","maxLength":500}},"required":["requirement","state"],"additionalProperties":false}}},"required":["rows"],"additionalProperties":false}"##;

pub(crate) fn ledger_input_schema() -> RawJson {
    RawJson::from_text(INPUT_SCHEMA.to_owned()).expect("the schema is fixed, valid JSON")
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) enum RowState {
    #[default]
    Pending,
    Done,
    Failed,
    Blocked,
    Skipped,
}

impl RowState {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Blocked => "blocked",
            Self::Skipped => "skipped",
        }
    }

    pub(super) fn parse(text: &str) -> Option<Self> {
        match text {
            "pending" => Some(Self::Pending),
            "done" => Some(Self::Done),
            "failed" => Some(Self::Failed),
            "blocked" => Some(Self::Blocked),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum EvidenceKind {
    Tab,
    Note,
    File,
    Receipt,
}

impl EvidenceKind {
    fn label(self) -> &'static str {
        match self {
            Self::Tab => "tab",
            Self::Note => "note",
            Self::File => "file",
            Self::Receipt => "receipt",
        }
    }

    pub(super) fn parse(text: &str) -> Option<Self> {
        match text {
            "tab" => Some(Self::Tab),
            "note" => Some(Self::Note),
            "file" => Some(Self::File),
            "receipt" => Some(Self::Receipt),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LedgerEvidence {
    pub(crate) kind: EvidenceKind,
    pub(crate) reference: String,
    pub(crate) summary: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Needs {
    None,
    Input,
    Takeover,
}

impl Needs {
    fn label(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Input => "input",
            Self::Takeover => "takeover",
        }
    }

    pub(super) fn parse(text: &str) -> Option<Self> {
        match text {
            "none" => Some(Self::None),
            "input" => Some(Self::Input),
            "takeover" => Some(Self::Takeover),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SentRow {
    pub(crate) id: Option<String>,
    pub(crate) requirement: String,
    pub(crate) state: RowState,
    pub(crate) evidence: Option<LedgerEvidence>,
    pub(crate) reason: Option<String>,
    pub(crate) needs: Option<Needs>,
    pub(crate) hint: Option<String>,
}

impl SentRow {
    pub(crate) fn matches(&self, known: &LedgerRow) -> bool {
        self.id
            .as_deref()
            .is_some_and(|id| !id.is_empty() && known.id == id)
            || known.requirement == self.requirement
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum RowField {
    Id,
    Requirement,
    State,
    Evidence,
    Reason,
    Needs,
    Hint,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LedgerRow {
    pub(crate) id: String,
    pub(crate) requirement: String,
    pub(crate) state: RowState,
    pub(crate) evidence: Option<LedgerEvidence>,
    pub(crate) reason: Option<String>,
    pub(crate) needs: Option<Needs>,
    pub(crate) hint: Option<String>,
    pub(crate) carried: bool,
    pub(crate) order: Vec<RowField>,
}

impl LedgerRow {
    pub(crate) fn from_sent(sent: SentRow, id: String) -> Self {
        let mut order = Vec::new();
        if sent.id.is_some() {
            order.push(RowField::Id);
        }
        order.extend(present_fields(&sent));
        if sent.id.is_none() {
            order.push(RowField::Id);
        }
        Self {
            id: sent.id.unwrap_or(id),
            requirement: sent.requirement,
            state: sent.state,
            evidence: sent.evidence,
            reason: sent.reason,
            needs: sent.needs,
            hint: sent.hint,
            carried: false,
            order,
        }
    }

    pub(crate) fn apply(&mut self, sent: SentRow) {
        let reopened = self.carried && sent.state != RowState::Done;
        let had_evidence = sent.evidence.is_some();
        for field in present_fields(&sent) {
            self.gain(field);
        }
        self.gain(RowField::Hint);
        self.requirement = sent.requirement;
        self.state = sent.state;
        if sent.evidence.is_some() {
            self.evidence = sent.evidence;
        }
        if sent.reason.is_some() {
            self.reason = sent.reason;
        }
        if sent.needs.is_some() {
            self.needs = sent.needs;
        }
        if sent.hint.is_some() {
            self.hint = sent.hint;
        }
        if reopened || had_evidence {
            self.carried = false;
        }
    }

    pub(crate) fn set_reason(&mut self, reason: String) {
        self.gain(RowField::Reason);
        self.reason = Some(reason);
    }

    fn gain(&mut self, field: RowField) {
        if !self.order.contains(&field) {
            self.order.push(field);
        }
    }

    pub(crate) fn to_js(&self) -> JsValue {
        let text = |value: &str| JsValue::String(value.to_owned());
        let fields = self
            .order
            .iter()
            .filter_map(|field| match field {
                RowField::Id => Some(("id", text(&self.id))),
                RowField::Requirement => Some(("requirement", text(&self.requirement))),
                RowField::State => Some(("state", text(self.state.label()))),
                RowField::Evidence => self.evidence.as_ref().map(|evidence| {
                    let fields = vec![
                        ("kind".to_owned(), text(evidence.kind.label())),
                        ("ref".to_owned(), text(&evidence.reference)),
                        ("summary".to_owned(), text(&evidence.summary)),
                    ];
                    ("evidence", JsValue::Object(fields))
                }),
                RowField::Reason => self
                    .reason
                    .as_deref()
                    .map(|reason| ("reason", text(reason))),
                RowField::Needs => self.needs.map(|needs| ("needs", text(needs.label()))),
                RowField::Hint => self.hint.as_deref().map(|hint| ("hint", text(hint))),
            })
            .map(|(name, value)| (name.to_owned(), value))
            .collect();
        JsValue::Object(fields)
    }
}

fn present_fields(sent: &SentRow) -> Vec<RowField> {
    let mut fields = vec![RowField::Requirement, RowField::State];
    if sent.evidence.is_some() {
        fields.push(RowField::Evidence);
    }
    if sent.reason.is_some() {
        fields.push(RowField::Reason);
    }
    if sent.needs.is_some() {
        fields.push(RowField::Needs);
    }
    if sent.hint.is_some() {
        fields.push(RowField::Hint);
    }
    fields
}
