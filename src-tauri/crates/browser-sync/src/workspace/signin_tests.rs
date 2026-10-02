use super::*;
use serde_json::json;

fn cookie(name: &str, domain: &str) -> Value {
    json!({
        "name": name, "value": "synthetic", "domain": domain, "path": "/",
        "host_only": !domain.starts_with('.'), "secure": true, "http_only": true,
        "same_site": "lax", "expires_unix_seconds": null, "partition_key": null
    })
}

fn local(origin: &str, payload: Value) -> BrowserObservation {
    BrowserObservation {
        area: Area::LocalStorage {
            origin: origin.into(),
        },
        payload,
    }
}

fn cookies(list: Vec<Value>) -> BrowserObservation {
    BrowserObservation {
        area: Area::Cookies,
        payload: Value::Array(list),
    }
}

/// Incompressible text: a keyed hash stream, printable so JSON stays compact.
fn noise(len: usize, seed: &str) -> String {
    let mut out = String::with_capacity(len + 64);
    let mut block = Sha256::digest(seed.as_bytes());
    while out.len() < len {
        out.push_str(&hex(&block));
        block = Sha256::digest(block);
    }
    out.truncate(len);
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn roundtrip(observations: &[BrowserObservation]) -> Vec<BrowserObservation> {
    let packed = pack(observations, &BTreeSet::new()).unwrap();
    assert!(packed.skipped.is_empty());
    unpack(packed.shards.values().map(Vec::as_slice)).unwrap()
}

fn sorted_cookies(observations: &[BrowserObservation]) -> Vec<String> {
    let mut out: Vec<String> = observations[0]
        .payload
        .as_array()
        .unwrap()
        .iter()
        .map(|c| canonical(c).to_string())
        .collect();
    out.sort();
    out
}

#[test]
fn round_trips_cookies_and_storage_across_slots() {
    let input = vec![
        cookies(vec![
            cookie("a", "example.test"),
            cookie("b", ".example.test"),
            cookie("c", "other.test"),
        ]),
        local("https://example.test", json!({"k": "v", "a": "b"})),
        BrowserObservation {
            area: Area::SessionStorage {
                origin: "https://example.test".into(),
                view_id: "tab-1".into(),
            },
            payload: json!({"s": "1"}),
        },
        BrowserObservation {
            area: Area::IndexedDb {
                origin: "https://other.test".into(),
            },
            payload: json!({"codec_version": 1, "databases": [{"name": "db", "version": 1, "stores": []}]}),
        },
    ];
    let output = roundtrip(&input);
    assert!(matches!(output[0].area, Area::Cookies));
    assert_eq!(sorted_cookies(&output), sorted_cookies(&input));
    assert_eq!(output.len(), 4);
    for observation in &input[1..] {
        assert!(output.iter().any(|o| serde_json::to_value(&o.area).unwrap()
            == serde_json::to_value(&observation.area).unwrap()
            && o.payload == observation.payload));
    }
    for kind in pack(&input, &BTreeSet::new()).unwrap().shards.keys() {
        assert!(is_signin_slot(*kind));
    }
}

#[test]
fn identical_data_in_any_order_packs_to_identical_shards() {
    let a = vec![
        cookies(vec![
            cookie("a", "example.test"),
            cookie("z", "example.test"),
        ]),
        local("https://example.test", json!({"k": "v", "a": "b"})),
    ];
    let mut reordered_payload = serde_json::Map::new();
    reordered_payload.insert("a".into(), json!("b"));
    reordered_payload.insert("k".into(), json!("v"));
    let b = vec![
        local("https://example.test", Value::Object(reordered_payload)),
        cookies(vec![
            cookie("z", "example.test"),
            cookie("a", "example.test"),
        ]),
    ];
    let first = pack(&a, &BTreeSet::new()).unwrap();
    let second = pack(&b, &BTreeSet::new()).unwrap();
    assert_eq!(first.shards, second.shards);
    assert_eq!(first.digests, second.digests);
    // Adding one site leaves every unrelated shard byte-identical.
    let mut grown = a.clone();
    grown.push(local("https://new.test", json!({"x": "y"})));
    let third = pack(&grown, &BTreeSet::new()).unwrap();
    let changed = third
        .digests
        .iter()
        .filter(|(k, d)| first.digests.get(k) != Some(d))
        .count();
    assert_eq!(changed, 1);
}

#[test]
fn a_unit_larger_than_a_slot_is_skipped_and_the_rest_still_packs() {
    let input = vec![
        cookies(vec![cookie("a", "example.test")]),
        local(
            "https://huge.test",
            json!({ "blob": noise(3 * MAX_FRAME, "huge") }),
        ),
        local("https://small.test", json!({"k": "v"})),
    ];
    let packed = pack(&input, &BTreeSet::new()).unwrap();
    assert_eq!(packed.skipped.len(), 1);
    assert_eq!(packed.skipped[0].reason, PackReason::TooLarge);
    assert!(
        matches!(&packed.skipped[0].area, Area::LocalStorage { origin } if origin == "https://huge.test")
    );
    let output = unpack(packed.shards.values().map(Vec::as_slice)).unwrap();
    assert_eq!(output.len(), 2);
}

#[test]
fn every_shard_fits_the_servers_slot_after_real_compression_and_padding() {
    // Incompressible sites that each fit alone but crowd shared slots.
    let input: Vec<_> = (0..40)
        .map(|i| {
            local(
                &format!("https://site{i}.test"),
                json!({ "v": noise(200 << 10, &i.to_string()) }),
            )
        })
        .collect();
    let packed = pack(&input, &BTreeSet::new()).unwrap();
    for plaintext in packed.shards.values() {
        let frame = codec::encode(plaintext, Padding::Bucket).unwrap();
        assert!(frame.len() <= MAX_FRAME, "frame {}", frame.len());
        // The server's limit: nonce + frame + tag within 1 MiB.
        assert!(frame.len() + 28 <= 1 << 20);
    }
    let kept = unpack(packed.shards.values().map(Vec::as_slice))
        .unwrap()
        .len()
        - 1;
    assert_eq!(kept + packed.skipped.len(), 40);
    assert!(packed
        .skipped
        .iter()
        .all(|s| s.reason == PackReason::SyncLimit));
    assert!(kept > 0);
}

#[test]
fn compressible_data_uses_far_more_than_the_raw_frame_size() {
    let big = "a".repeat(2 << 20);
    let packed = pack(
        &[local("https://big.test", json!({ "v": big }))],
        &BTreeSet::new(),
    )
    .unwrap();
    assert!(packed.skipped.is_empty());
    assert_eq!(
        unpack(packed.shards.values().map(Vec::as_slice))
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn unpack_rejects_tampered_or_invalid_shards() {
    let packed = pack(
        &[local("https://example.test", json!({"k": "v"}))],
        &BTreeSet::new(),
    )
    .unwrap();
    let shard = packed.shards.values().next().unwrap().clone();
    // The same area in two shards is ambiguous.
    assert!(unpack([shard.as_slice(), shard.as_slice()]).is_err());
    assert!(unpack([br#"{"version":2,"units":[]}"#.as_slice()]).is_err());
    assert!(unpack([br#"{"version":1,"units":[],"extra":1}"#.as_slice()]).is_err());
    let bad_origin = br#"{"version":1,"units":[{"area":{"kind":"local_storage","origin":"file:///etc"},"payload":{}}]}"#;
    assert!(unpack([bad_origin.as_slice()]).is_err());
    // No shards at all is a valid, empty profile with an explicit cookie area.
    let empty = unpack(std::iter::empty()).unwrap();
    assert_eq!(empty.len(), 1);
    assert!(matches!(empty[0].area, Area::Cookies));
}
