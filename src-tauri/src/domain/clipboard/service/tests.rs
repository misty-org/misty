use super::*;

#[test]
fn fingerprint_changes_with_binary_image_content() {
    let mut first = ClipboardPayload {
        kind: ClipboardPayloadKind::Image,
        images: vec![super::super::ClipboardImage {
            bytes: vec![1, 2, 3],
            ..super::super::ClipboardImage::default()
        }],
        ..ClipboardPayload::default()
    };
    let first_fingerprint = ClipboardService::fingerprint_for(&first);
    first.images[0].bytes[2] = 4;
    assert_ne!(first_fingerprint, ClipboardService::fingerprint_for(&first));
}

#[test]
fn fingerprint_distinguishes_remote_file_ref_provider_metadata() {
    let first = ClipboardPayload {
        kind: ClipboardPayloadKind::FileRefs,
        file_refs: vec![super::super::ClipboardFileRef {
            display_name: "report.pdf".into(),
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/report.pdf".into(),
            ..super::super::ClipboardFileRef::default()
        }],
        ..ClipboardPayload::default()
    };
    let mut second = first.clone();
    second.file_refs[0].provider_type = "onedrive".into();
    let mut third = first.clone();
    third.file_refs[0].display_name = "renamed-report.pdf".into();

    let first_fingerprint = ClipboardService::fingerprint_for(&first);
    assert_ne!(
        first_fingerprint,
        ClipboardService::fingerprint_for(&second)
    );
    assert_ne!(first_fingerprint, ClipboardService::fingerprint_for(&third));
}

#[test]
fn remote_lamport_clock_rejects_stale_payloads_and_breaks_ties_by_endpoint() {
    let service = ClipboardService::new(None, None);
    let remote = |revision, endpoint: &str, text: &str| ClipboardPayload {
        kind: ClipboardPayloadKind::Text,
        source_device_id: endpoint.to_owned(),
        revision,
        text: text.to_owned(),
        ..ClipboardPayload::default()
    };
    service.accept_remote_payload(remote(7, "endpoint-b", "new"));
    service.accept_remote_payload(remote(6, "endpoint-z", "stale"));
    service.accept_remote_payload(remote(7, "endpoint-a", "lower tie"));
    assert_eq!(service.latest_shared().text, "new");

    service.accept_remote_payload(remote(7, "endpoint-c", "higher tie"));
    assert_eq!(service.latest_shared().text, "higher tie");
    assert_eq!(
        service.latest_shared().origin,
        ClipboardOrigin::RemoteShared
    );
}
