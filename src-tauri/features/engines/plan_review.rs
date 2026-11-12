// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/plan_review.rs.
//! The smallest typed contract for plan preview and human review.
//!
//! The source of truth is the `cli_plan_reviews` table plus the native reply context parked in
//! the backend registry; neither the CLI transcript nor the search index carries review meaning.
//! The renderer submits only `planId + expectedRevision + decision + optional feedback`; native
//! RPC methods, paths and reply contexts never leave native code.
//!
//! Review states:
//! `draft → awaiting_review → submitting → approved | changes_requested | deferred`
//! plus the terminal `cancelled | expired | superseded`. `deferred` (not now) is not terminal:
//! the native wait point is still parked, and the person can come back to the same session and
//! decide (both deferred and awaiting_review accept a submission).
//!
//! Execution is tracked apart: `not_started / starting / running / completed / failed /
//! unknown`. approved is not "executed"; a successful pipe write is no proof the other side ran
//! it either. A lost connection may only be marked unknown and checked upstream first, never
//! blindly resent (no engine has an idempotent approval key).

use crate::engines::support::db::Db;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What an engine offers for plan review: whether, the evidence, the review kind, the limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PlanApproval {
    /// The typed human-review path is wired (declared per engine adapter).
    Typed {
        #[serde(rename = "reviewKind")]
        review_kind: PlanReviewKind,
        /// Where the transport/version was verified (source and version).
        evidence: &'static str,
        /// The limits the person is told about.
        limitations: &'static str,
    },
    /// The engine's own plan entry point, with its existing behavior (claude/kimi/agy/opencode);
    /// it doesn't go through this review path.
    Legacy,
    /// No verifiable human plan review: an explicit plan request is refused before launch, never
    /// silently downgraded through resolve_permission or an auto-approve flag.
    Unavailable { reason: &'static str },
}

/// The two native lifecycles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanReviewKind {
    /// The native request really pauses execution until the client answers in its format (OMP/DSH/Grok/Qoder).
    NativeRequest,
    /// The plan turn ends normally and the client arbitrates; approval = one new execution turn (Codex).
    NextTurn,
}

impl PlanReviewKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NativeRequest => "native_request",
            Self::NextTurn => "next_turn",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        match s {
            "native_request" => Some(Self::NativeRequest),
            "next_turn" => Some(Self::NextTurn),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    AwaitingReview,
    Submitting,
    Approved,
    ChangesRequested,
    Deferred,
    Cancelled,
    Expired,
    Superseded,
}

impl PlanStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::AwaitingReview => "awaiting_review",
            Self::Submitting => "submitting",
            Self::Approved => "approved",
            Self::ChangesRequested => "changes_requested",
            Self::Deferred => "deferred",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
            Self::Superseded => "superseded",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "draft" => Self::Draft,
            "awaiting_review" => Self::AwaitingReview,
            "submitting" => Self::Submitting,
            "approved" => Self::Approved,
            "changes_requested" => Self::ChangesRequested,
            "deferred" => Self::Deferred,
            "cancelled" => Self::Cancelled,
            "expired" => Self::Expired,
            "superseded" => Self::Superseded,
            _ => return None,
        })
    }
    /// A decision may only be claimed atomically from these two states; every other state
    /// (submitting and all terminal ones) is a conflict.
    fn accepts_submission(self) -> bool {
        matches!(self, Self::AwaitingReview | Self::Deferred)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanExecution {
    NotStarted,
    Starting,
    Running,
    Completed,
    Failed,
    Unknown,
}

impl PlanExecution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "not_started" => Self::NotStarted,
            "starting" => Self::Starting,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "unknown" => Self::Unknown,
            _ => return None,
        })
    }
}

/// The person's decision. The renderer submits only this and optional feedback; an approval carries no native parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanDecision {
    Approve,
    RequestChanges,
    Defer,
}

impl PlanDecision {
    /// The review state once the decision takes effect.
    pub fn settled_status(self) -> PlanStatus {
        match self {
            Self::Approve => PlanStatus::Approved,
            Self::RequestChanges => PlanStatus::ChangesRequested,
            Self::Defer => PlanStatus::Deferred,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::RequestChanges => "request_changes",
            Self::Defer => "defer",
        }
    }
}

/// A plan review record (the source of truth). Identity = workspace + engine + session +
/// run/turn + planId + revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanReview {
    pub plan_id: String,
    pub engine: String,
    pub session_id: String,
    pub workspace_path: String,
    pub run_id: Option<String>,
    pub revision: i64,
    pub title: String,
    /// The final Markdown the person sees and copies; it must match the native final text exactly.
    pub content: String,
    /// Content change detection (not a secure hash; checked again before submit; the TOCTOU
    /// limit of file-based sources is stated in the capability declaration).
    pub content_hash: String,
    /// false = a draft or an uncertain source: every approval path must refuse it.
    pub complete: bool,
    pub review_kind: PlanReviewKind,
    /// The native plan/item id (the engine's own, kept as is).
    pub native_plan_id: Option<String>,
    /// The execution permission an approval keeps; approving must not change it.
    pub exec_permission: String,
    pub status: PlanStatus,
    pub execution: PlanExecution,
    /// The stored decision intent {decision, feedback?}; kept when a pipe write fails or the connection is lost.
    pub decision: Option<Value>,
    pub decision_intent_at: Option<i64>,
    /// When the native acknowledgement or state change was recorded; None = not yet acknowledged (unknown included).
    pub applied_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub superseded_by: Option<i64>,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A non-cryptographic content fingerprint: detects content changes between revisions and around
/// a submit. Not a security binding (a race on a native file can only be settled by an
/// immutable upstream proposal), so the standard library's SipHash is enough.
pub fn content_hash(content: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.len().hash(&mut hasher);
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Records a new plan revision: revision = the planId's highest revision + 1, and every older
/// one is marked superseded (approved or replaced revisions can only be viewed and copied, no
/// longer approved). Returns the new record's revision.
pub(crate) fn record_review(db: &Db, review: &PlanReview) -> Result<i64, String> {
    let conn = db.0.lock();
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(revision), 0) + 1 FROM cli_plan_reviews WHERE plan_id=?1",
            rusqlite::params![review.plan_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let now = now_ms();
    conn.execute(
        "UPDATE cli_plan_reviews SET status=?1, superseded_by=?2, updated_at=?3
         WHERE plan_id=?4 AND status IN (?5, ?6, ?7, ?8)",
        rusqlite::params![
            PlanStatus::Superseded.as_str(),
            next,
            now,
            review.plan_id,
            PlanStatus::Draft.as_str(),
            PlanStatus::AwaitingReview.as_str(),
            PlanStatus::Submitting.as_str(),
            PlanStatus::Deferred.as_str(),
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO cli_plan_reviews
            (plan_id, engine, session_id, workspace_path, run_id, revision,
             title, content, content_hash, complete, review_kind, native_plan_id,
             exec_permission, status, execution, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)",
        rusqlite::params![
            review.plan_id,
            review.engine,
            review.session_id,
            review.workspace_path,
            review.run_id,
            next,
            review.title,
            review.content,
            review.content_hash,
            review.complete as i64,
            review.review_kind.as_str(),
            review.native_plan_id,
            review.exec_permission,
            review.status.as_str(),
            review.execution.as_str(),
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(next)
}

fn map_review(row: &rusqlite::Row) -> rusqlite::Result<PlanReview> {
    let status: String = row.get(13)?;
    let execution: String = row.get(14)?;
    let review_kind: String = row.get(10)?;
    Ok(PlanReview {
        plan_id: row.get(0)?,
        engine: row.get(1)?,
        session_id: row.get(2)?,
        workspace_path: row.get(3)?,
        run_id: row.get(4)?,
        revision: row.get(5)?,
        title: row.get(6)?,
        content: row.get(7)?,
        content_hash: row.get(8)?,
        complete: row.get::<_, i64>(9)? != 0,
        review_kind: PlanReviewKind::parse(&review_kind).unwrap_or(PlanReviewKind::NativeRequest),
        native_plan_id: row.get(11)?,
        exec_permission: row.get(12)?,
        status: PlanStatus::parse(&status).unwrap_or(PlanStatus::Expired),
        execution: PlanExecution::parse(&execution).unwrap_or(PlanExecution::Unknown),
        decision: row
            .get::<_, Option<String>>(15)?
            .and_then(|raw| serde_json::from_str(&raw).ok()),
        decision_intent_at: row.get(16)?,
        applied_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        superseded_by: row.get(20)?,
    })
}

const REVIEW_COLUMNS: &str = "plan_id, engine, session_id, workspace_path, run_id,
     revision, title, content, content_hash, complete, review_kind, native_plan_id,
     exec_permission, status, execution, decision, decision_intent_at, applied_at,
     created_at, updated_at, superseded_by";

pub(crate) fn get_review(
    db: &Db,
    plan_id: &str,
    revision: i64,
) -> Result<Option<PlanReview>, String> {
    let conn = db.0.lock();
    conn.query_row(
        &format!("SELECT {REVIEW_COLUMNS} FROM cli_plan_reviews WHERE plan_id=?1 AND revision=?2"),
        rusqlite::params![plan_id, revision],
        map_review,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Every plan revision of a session (deduplicated by the planId/revision key).
pub(crate) fn list_reviews(db: &Db, engine: &str, session_id: &str) -> Result<Vec<PlanReview>, String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {REVIEW_COLUMNS} FROM cli_plan_reviews
             WHERE engine=?1 AND session_id=?2
             ORDER BY plan_id, revision"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![engine, session_id], map_review)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Compare-and-set result: either this call claimed the submission, or the current state comes
/// back for the caller to show the conflict (a repeated click gets the same result or a conflict).
#[derive(Debug)]
pub(crate) enum SubmitOutcome {
    /// Claimed: the record is now submitting and the decision intent is stored.
    Claimed { previous: PlanStatus },
    /// Conflict: the current state or revision isn't what the caller expected.
    Conflict(Box<PlanReview>),
}

/// Claims a submission atomically: an update conditioned on expectedRevision and state, read
/// then written under the db lock, so at most one submitter per planId/revision (double clicks,
/// two windows, retries).
pub(crate) fn submit_decision(
    db: &Db,
    plan_id: &str,
    expected_revision: i64,
    decision: PlanDecision,
    feedback: Option<&str>,
) -> Result<SubmitOutcome, String> {
    if decision == PlanDecision::RequestChanges
        && feedback.map(|f| f.trim().is_empty()).unwrap_or(true)
    {
        return Err("request_changes requires non-empty feedback".to_string());
    }
    let conn = db.0.lock();
    let current = conn
        .query_row(
            &format!("SELECT {REVIEW_COLUMNS} FROM cli_plan_reviews WHERE plan_id=?1 AND revision=?2"),
            rusqlite::params![plan_id, expected_revision],
            map_review,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(current) = current else {
        return Err("plan review not found for this revision".to_string());
    };
    if !current.complete {
        return Err("plan content is incomplete; approval is not allowed yet".to_string());
    }
    if !current.status.accepts_submission() {
        return Ok(SubmitOutcome::Conflict(Box::new(current)));
    }
    let decision_json = serde_json::json!({
        "decision": decision.as_str(),
        "feedback": feedback,
    });
    let now = now_ms();
    conn.execute(
        "UPDATE cli_plan_reviews
         SET status=?1, decision=?2, decision_intent_at=?3, updated_at=?3
         WHERE plan_id=?4 AND revision=?5",
        rusqlite::params![
            PlanStatus::Submitting.as_str(),
            decision_json.to_string(),
            now,
            plan_id,
            expected_revision,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(SubmitOutcome::Claimed {
        previous: current.status,
    })
}

/// Records the native acknowledgement: submitting → the decision's terminal state, applied_at = when.
pub(crate) fn mark_applied(
    db: &Db,
    plan_id: &str,
    revision: i64,
    decision: PlanDecision,
) -> Result<(), String> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE cli_plan_reviews SET status=?1, applied_at=?2, updated_at=?2
         WHERE plan_id=?3 AND revision=?4 AND status=?5",
        rusqlite::params![
            decision.settled_status().as_str(),
            now_ms(),
            plan_id,
            revision,
            PlanStatus::Submitting.as_str(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The pipe write failed: the decision intent is kept (decision/decision_intent_at untouched),
/// the state goes back to what it was before the claim, and an approval never shows as done.
pub(crate) fn revert_submission(
    db: &Db,
    plan_id: &str,
    revision: i64,
    previous: PlanStatus,
) -> Result<(), String> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE cli_plan_reviews SET status=?1, updated_at=?2
         WHERE plan_id=?3 AND revision=?4 AND status=?5",
        rusqlite::params![
            previous.as_str(),
            now_ms(),
            plan_id,
            revision,
            PlanStatus::Submitting.as_str(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Advances the execution state (approved is not executed; a lost connection is unknown, checked upstream first).
pub(crate) fn mark_execution(
    db: &Db,
    plan_id: &str,
    revision: i64,
    execution: PlanExecution,
) -> Result<(), String> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE cli_plan_reviews SET execution=?1, updated_at=?2
         WHERE plan_id=?3 AND revision=?4",
        rusqlite::params![execution.as_str(), now_ms(), plan_id, revision],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// When a run ends, its parked plans all expire: the native request died with the process, and
/// history must not pretend they can still be approved. next_turn plans have no parked context
/// and never appear here. Returns (plan_id, revision, previous state).
pub(crate) fn expire_reviews(
    db: &Db,
    parked: &[(String, i64)],
) -> Result<Vec<(String, i64, PlanStatus)>, String> {
    if parked.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.0.lock();
    let now = now_ms();
    let mut expired = Vec::new();
    for (plan_id, revision) in parked {
        let previous = conn
            .query_row(
                "SELECT status FROM cli_plan_reviews WHERE plan_id=?1 AND revision=?2",
                rusqlite::params![plan_id, revision],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .and_then(|s| PlanStatus::parse(&s));
        let Some(previous) = previous else { continue };
        // Only revisions still open for review expire; decided and terminal ones stay.
        if !matches!(
            previous,
            PlanStatus::Draft
                | PlanStatus::AwaitingReview
                | PlanStatus::Submitting
                | PlanStatus::Deferred
        ) {
            continue;
        }
        conn.execute(
            "UPDATE cli_plan_reviews SET status=?1, updated_at=?2
             WHERE plan_id=?3 AND revision=?4",
            rusqlite::params![PlanStatus::Expired.as_str(), now, plan_id, revision],
        )
        .map_err(|e| e.to_string())?;
        expired.push((plan_id.clone(), *revision, previous));
    }
    Ok(expired)
}

/// Cleaned up with the session or workspace that goes away (no ghost plans after a delete; a
/// sessions row can be created after the plan record, so there is no foreign key and each delete
/// path cleans up explicitly). The caller passes its connection inside its own transaction.
pub(crate) fn delete_reviews_for_session(
    conn: &rusqlite::Connection,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM cli_plan_reviews WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn delete_reviews_for_workspace(
    conn: &rusqlite::Connection,
    workspace_path: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM cli_plan_reviews WHERE workspace_path=?1",
        rusqlite::params![workspace_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> (Db, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-plan-review-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        (Db::open_at(&path).unwrap(), dir)
    }

    fn review(plan_id: &str, session: &str) -> PlanReview {
        PlanReview {
            plan_id: plan_id.into(),
            engine: "dsh".into(),
            session_id: session.into(),
            workspace_path: "/tmp/ws".into(),
            run_id: Some("run-1".into()),
            revision: 1,
            title: "Test plan".into(),
            content: "# Plan\nStep one".into(),
            content_hash: content_hash("# Plan\nStep one"),
            complete: true,
            review_kind: PlanReviewKind::NativeRequest,
            native_plan_id: Some("plan-review".into()),
            exec_permission: "auto".into(),
            status: PlanStatus::AwaitingReview,
            execution: PlanExecution::NotStarted,
            decision: None,
            decision_intent_at: None,
            applied_at: None,
            created_at: 0,
            updated_at: 0,
            superseded_by: None,
        }
    }

    #[test]
    fn new_revision_supersedes_open_versions_only() {
        let (db, dir) = temp_db("supersede");
        let r = review("p1", "s1");
        assert_eq!(record_review(&db, &r).unwrap(), 1);
        // Second revision: the old one is superseded, the new one is revision 2.
        let mut r2 = review("p1", "s1");
        r2.content = "# Plan\nStep one\nStep two".into();
        r2.content_hash = content_hash(&r2.content);
        assert_eq!(record_review(&db, &r2).unwrap(), 2);
        let old = get_review(&db, "p1", 1).unwrap().unwrap();
        assert_eq!(old.status, PlanStatus::Superseded);
        assert_eq!(old.superseded_by, Some(2));
        let new = get_review(&db, "p1", 2).unwrap().unwrap();
        assert_eq!(new.status, PlanStatus::AwaitingReview);
        // Third revision: r1, already superseded, stays; r2 is replaced.
        assert_eq!(record_review(&db, &review("p1", "s1")).unwrap(), 3);
        let r1 = get_review(&db, "p1", 1).unwrap().unwrap();
        assert_eq!(r1.superseded_by, Some(2));
        let r2 = get_review(&db, "p1", 2).unwrap().unwrap();
        assert_eq!(r2.status, PlanStatus::Superseded);
        assert_eq!(r2.superseded_by, Some(3));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cas_claims_exactly_once_and_conflicts_afterwards() {
        let (db, dir) = temp_db("cas");
        record_review(&db, &review("p1", "s1")).unwrap();
        // The first submitter claims it.
        let first = submit_decision(&db, "p1", 1, PlanDecision::Approve, None).unwrap();
        assert!(matches!(
            first,
            SubmitOutcome::Claimed {
                previous: PlanStatus::AwaitingReview
            }
        ));
        // A double click or a second window: the same revision can't be submitted again.
        let second = submit_decision(&db, "p1", 1, PlanDecision::Approve, None).unwrap();
        match second {
            SubmitOutcome::Conflict(current) => {
                assert_eq!(current.status, PlanStatus::Submitting)
            }
            SubmitOutcome::Claimed { .. } => panic!("double submit must conflict"),
        }
        // A stale revision can't be submitted.
        let stale = submit_decision(&db, "p1", 99, PlanDecision::Approve, None);
        assert!(stale.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn applied_and_revert_follow_the_intent_first_rule() {
        let (db, dir) = temp_db("intent");
        record_review(&db, &review("p1", "s1")).unwrap();
        submit_decision(&db, "p1", 1, PlanDecision::Approve, None).unwrap();
        mark_applied(&db, "p1", 1, PlanDecision::Approve).unwrap();
        let approved = get_review(&db, "p1", 1).unwrap().unwrap();
        assert_eq!(approved.status, PlanStatus::Approved);
        assert!(approved.applied_at.is_some());

        record_review(&db, &review("p2", "s1")).unwrap();
        submit_decision(&db, "p2", 1, PlanDecision::Defer, None).unwrap();
        revert_submission(&db, "p2", 1, PlanStatus::AwaitingReview).unwrap();
        let reverted = get_review(&db, "p2", 1).unwrap().unwrap();
        // The pipe write failed: back to awaiting review, the intent kept, no approval shown.
        assert_eq!(reverted.status, PlanStatus::AwaitingReview);
        assert!(reverted.decision_intent_at.is_some());
        assert!(reverted.applied_at.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn request_changes_requires_feedback_and_deferred_can_resubmit() {
        let (db, dir) = temp_db("feedback");
        record_review(&db, &review("p1", "s1")).unwrap();
        assert!(submit_decision(&db, "p1", 1, PlanDecision::RequestChanges, None).is_err());
        assert!(submit_decision(&db, "p1", 1, PlanDecision::RequestChanges, Some("  ")).is_err());
        // After "not now" the same revision can still be decided.
        submit_decision(&db, "p1", 1, PlanDecision::Defer, None).unwrap();
        mark_applied(&db, "p1", 1, PlanDecision::Defer).unwrap();
        let deferred = get_review(&db, "p1", 1).unwrap().unwrap();
        assert_eq!(deferred.status, PlanStatus::Deferred);
        let resubmitted = submit_decision(&db, "p1", 1, PlanDecision::Approve, None).unwrap();
        assert!(matches!(resubmitted, SubmitOutcome::Claimed { .. }));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn incomplete_plan_never_accepts_submission() {
        let (db, dir) = temp_db("incomplete");
        let mut draft = review("p1", "s1");
        draft.complete = false;
        draft.status = PlanStatus::Draft;
        record_review(&db, &draft).unwrap();
        assert!(submit_decision(&db, "p1", 1, PlanDecision::Approve, None).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn expire_only_closes_open_versions() {
        let (db, dir) = temp_db("expire");
        record_review(&db, &review("p1", "s1")).unwrap();
        let mut approved = review("p2", "s1");
        record_review(&db, &approved).unwrap();
        submit_decision(&db, "p2", 1, PlanDecision::Approve, None).unwrap();
        mark_applied(&db, "p2", 1, PlanDecision::Approve).unwrap();
        approved.plan_id = "p2".into();
        let expired = expire_reviews(&db, &[("p1".into(), 1), ("p2".into(), 1)]).unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].0, "p1");
        assert_eq!(
            get_review(&db, "p1", 1).unwrap().unwrap().status,
            PlanStatus::Expired
        );
        // An approved revision doesn't expire.
        assert_eq!(
            get_review(&db, "p2", 1).unwrap().unwrap().status,
            PlanStatus::Approved
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn delete_follows_session_and_workspace_lifecycle() {
        let (db, dir) = temp_db("delete");
        record_review(&db, &review("p1", "s1")).unwrap();
        record_review(&db, &review("p2", "s2")).unwrap();
        {
            let conn = db.0.lock();
            delete_reviews_for_session(&conn, "dsh", "s1").unwrap();
            delete_reviews_for_workspace(&conn, "/tmp/ws-empty").unwrap();
        }
        assert!(get_review(&db, "p1", 1).unwrap().is_none());
        assert!(get_review(&db, "p2", 1).unwrap().is_some());
        {
            let conn = db.0.lock();
            delete_reviews_for_workspace(&conn, "/tmp/ws").unwrap();
        }
        assert!(get_review(&db, "p2", 1).unwrap().is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn records_survive_reopen() {
        let (db, dir) = temp_db("reopen");
        let path = dir.join("test.db");
        record_review(&db, &review("p1", "s1")).unwrap();
        drop(db);
        let reopened = Db::open_at(&path).unwrap();
        let loaded = get_review(&reopened, "p1", 1).unwrap().unwrap();
        assert_eq!(loaded.content, "# Plan\nStep one");
        assert_eq!(loaded.status, PlanStatus::AwaitingReview);
        assert_eq!(list_reviews(&reopened, "dsh", "s1").unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }
}
