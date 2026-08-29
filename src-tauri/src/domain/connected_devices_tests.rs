use super::*;
use ed25519_dalek::{Signer, SigningKey};

#[test]
fn control_frames_are_bounded_and_round_trip() {
    let request = PeerRequestEnvelope {
        request_id: "request-1".to_owned(),
        request: PeerRequest::Ping { nonce: 42 },
    };
    let frame = encode_control_frame(&request).expect("encode");
    let decoded: PeerRequestEnvelope = decode_control_frame(&frame).expect("decode");
    assert_eq!(decoded, request);

    let mut malformed = frame.clone();
    malformed[..4].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(decode_control_frame::<PeerRequestEnvelope>(&malformed).is_err());
}

#[test]
fn clipboard_limits_and_file_traversal_are_rejected() {
    let offer = ClipboardOffer {
        source_endpoint_id: "source".to_owned(),
        revision: 1,
        kind: ClipboardOfferKind::FileReferences {
            files: vec![PeerFileReference {
                device_id: "device".to_owned(),
                root_id: "root".to_owned(),
                relative_path: "../private.txt".to_owned(),
                is_directory: false,
                snapshot: "snapshot".to_owned(),
            }],
            fallback_text: "private.txt".to_owned(),
        },
    };
    assert_eq!(
        validate_clipboard_offer(&offer).unwrap_err().code,
        PeerErrorCode::MalformedRequest
    );
}

#[test]
fn tickets_enforce_signature_expiry_endpoint_identity_and_replay() {
    let signing = SigningKey::from_bytes(&[7u8; 32]);
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","kid":"current"}"#);
    let claims = PeerTicketClaims {
        iss: "misty-api".to_owned(),
        aud: TICKET_PROTOCOL_VERSION.to_owned(),
        jti: "ticket-1".to_owned(),
        pair_id: "pair-1".to_owned(),
        source_device_id: "device-a".to_owned(),
        source_endpoint_id: "endpoint-a".to_owned(),
        target_device_id: "device-b".to_owned(),
        target_endpoint_id: "endpoint-b".to_owned(),
        protocol_version: TICKET_PROTOCOL_VERSION.to_owned(),
        permissions: vec!["files:read".to_owned()],
        iat: 1_000,
        exp: 1_300,
    };
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).expect("claims"));
    let input = format!("{header}.{payload}");
    let signature = URL_SAFE_NO_PAD.encode(signing.sign(input.as_bytes()).to_bytes());
    let ticket = format!("{input}.{signature}");
    let mut keys = HashMap::new();
    keys.insert("current".to_owned(), signing.verifying_key());
    let mut used = HashMap::new();

    verify_peer_ticket(&ticket, &keys, "endpoint-a", "endpoint-b", 1_001, &mut used)
        .expect("valid ticket");
    assert!(
        verify_peer_ticket(&ticket, &keys, "endpoint-a", "endpoint-b", 1_001, &mut used,).is_err()
    );
    assert!(verify_peer_ticket(
        &ticket,
        &keys,
        "wrong",
        "endpoint-b",
        1_001,
        &mut HashMap::new(),
    )
    .is_err());
    assert!(verify_peer_ticket(
        &ticket,
        &keys,
        "endpoint-a",
        "endpoint-b",
        1_300,
        &mut HashMap::new(),
    )
    .is_err());
}
#[test]
fn space_tickets_bind_installation_devices_permissions_and_replay() {
    use serde_json::json;
    let signing = SigningKey::from_bytes(&[8u8; 32]);
    let keys = HashMap::from([("current".to_string(), signing.verifying_key())]);
    let expected = SpacePeerAuthority {
        space_id: "family",
        installed_version: "1.1.5",
        authority_generation: 7,
        source_device_id: "device-a",
        target_device_id: "device-b",
        source_endpoint_id: "endpoint-a",
        target_endpoint_id: "endpoint-b",
    };
    let claims = json!({"iss":"misty-api","aud":"misty-device/2","protocolVersion":"misty-device/2","jti":"space-ticket","pairId":"pair-1",
        "sourceDeviceId":"device-a","targetDeviceId":"device-b","sourceEndpointId":"endpoint-a","targetEndpointId":"endpoint-b",
        "spaceId":"family","appId":"files","installedVersion":"1.1.5","authorityGeneration":7,
        "permissions":["files:read","roots:read","directories:subscribe"],"iat":1000,"exp":1300});
    let sign = |claims: &serde_json::Value| {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","kid":"current"}"#);
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap());
        let input = format!("{header}.{payload}");
        format!(
            "{input}.{}",
            URL_SAFE_NO_PAD.encode(signing.sign(input.as_bytes()).to_bytes())
        )
    };
    let ticket = sign(&claims);
    let mut replay = HashMap::new();
    for (field, value) in [
        ("spaceId", json!("work")),
        ("appId", json!("terminal")),
        ("installedVersion", json!("1.1.4")),
        ("authorityGeneration", json!(6)),
        ("sourceDeviceId", json!("device-c")),
        ("targetDeviceId", json!("device-c")),
        ("sourceEndpointId", json!("endpoint-c")),
        ("targetEndpointId", json!("endpoint-c")),
        ("aud", json!("misty-device/1")),
        ("protocolVersion", json!("misty-device/1")),
        ("permissions", json!(["files:read", "clipboard:send"])),
        ("permissions", json!([])),
        ("iat", json!(1040)),
        ("exp", json!(1001)),
    ] {
        let mut changed = claims.clone();
        changed[field] = value;
        assert!(
            verify_space_peer_ticket(&sign(&changed), &keys, &expected, 1001, &mut replay).is_err(),
            "accepted {field}"
        );
        assert!(replay.is_empty(), "invalid ticket consumed replay state");
    }
    let mut missing = claims.clone();
    missing.as_object_mut().unwrap().remove("spaceId");
    assert!(
        verify_space_peer_ticket(&sign(&missing), &keys, &expected, 1001, &mut replay).is_err()
    );
    let mut overflow = claims.clone();
    overflow["iat"] = json!(i64::MIN);
    overflow["exp"] = json!(i64::MAX);
    assert!(
        verify_space_peer_ticket(&sign(&overflow), &keys, &expected, 1001, &mut replay).is_err()
    );
    assert!(verify_peer_ticket(
        &ticket,
        &keys,
        "endpoint-a",
        "endpoint-b",
        1001,
        &mut replay
    )
    .is_err());
    let verified = verify_space_peer_ticket(&ticket, &keys, &expected, 1001, &mut replay).unwrap();
    assert_eq!(verified.authority_generation, 7);
    assert!(verify_space_peer_ticket(&ticket, &keys, &expected, 1001, &mut replay).is_err());
    let mut legacy = claims.clone();
    legacy["aud"] = json!("misty-device/1");
    legacy["protocolVersion"] = json!("misty-device/1");
    for field in [
        "spaceId",
        "appId",
        "installedVersion",
        "authorityGeneration",
    ] {
        legacy.as_object_mut().unwrap().remove(field);
    }
    assert!(
        verify_space_peer_ticket(&sign(&legacy), &keys, &expected, 1001, &mut HashMap::new())
            .is_err()
    );
}
