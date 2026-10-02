use super::*;
use crate::domain::file_sync::{
    FileSyncCompareRow, FileSyncCompareSide, FileSyncEndpoint, FileSyncEndpointKind,
};

fn pair(policy: FileSyncPolicy) -> FileSyncPair {
    FileSyncPair {
        left: FileSyncEndpoint {
            kind: FileSyncEndpointKind::Local,
            local_path: "/local".into(),
            ..FileSyncEndpoint::default()
        },
        right: FileSyncEndpoint {
            kind: FileSyncEndpointKind::Remote,
            remote_name: "drive".into(),
            remote_path: "/".into(),
            ..FileSyncEndpoint::default()
        },
        preferred_policy: policy,
        ..FileSyncPair::default()
    }
}

fn row(disposition: FileSyncCompareDisposition) -> FileSyncCompareRow {
    FileSyncCompareRow {
        disposition,
        left: FileSyncCompareSide::default(),
        right: FileSyncCompareSide::default(),
        ..FileSyncCompareRow::default()
    }
}

#[test]
fn bidirectional_watch_copies_presence_and_leaves_differences_for_review() {
    let rows = watched_actions(
        &pair(FileSyncPolicy::BiDirectional),
        vec![
            row(FileSyncCompareDisposition::LeftOnly),
            row(FileSyncCompareDisposition::RightOnly),
            row(FileSyncCompareDisposition::Different),
        ],
    );
    assert_eq!(rows[0].action, FileSyncPlannedAction::CopyLeftToRight);
    assert_eq!(rows[1].action, FileSyncPlannedAction::CopyRightToLeft);
    assert_eq!(rows[2].action, FileSyncPlannedAction::Skip);
}

#[test]
fn remote_first_watch_mirrors_remote_presence_to_local() {
    let rows = watched_actions(
        &pair(FileSyncPolicy::RemoteFirst),
        vec![
            row(FileSyncCompareDisposition::LeftOnly),
            row(FileSyncCompareDisposition::RightOnly),
            row(FileSyncCompareDisposition::Different),
        ],
    );
    assert_eq!(rows[0].action, FileSyncPlannedAction::DeleteLeft);
    assert_eq!(rows[1].action, FileSyncPlannedAction::CopyRightToLeft);
    assert_eq!(rows[2].action, FileSyncPlannedAction::CopyRightToLeft);
}

#[test]
fn pair_display_name_prefers_saved_name_and_falls_back_to_id() {
    let mut named = pair(FileSyncPolicy::BiDirectional);
    named.id = 7;
    named.name = "  Documents mirror  ".into();
    assert_eq!(pair_display_name(&named), "Documents mirror");

    named.name.clear();
    assert_eq!(pair_display_name(&named), "#7");
}

#[test]
fn operation_status_helper_treats_only_finished_states_as_terminal() {
    use crate::domain::operation_queue::OperationStatus;

    assert!(!terminal_operation_status(OperationStatus::Queued));
    assert!(!terminal_operation_status(OperationStatus::InProgress));
    assert!(!terminal_operation_status(
        OperationStatus::WaitingForResolution
    ));
    assert!(terminal_operation_status(OperationStatus::Completed));
    assert!(terminal_operation_status(OperationStatus::Failed));
    assert!(terminal_operation_status(OperationStatus::Canceled));
    assert!(terminal_operation_status(OperationStatus::Skipped));
}
