use super::*;
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING};

/// DER SPKI header for a P-256 key; the 65-byte uncompressed point follows.
const P256_SPKI_PREFIX: [u8; 26] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
];

struct Key {
    pair: EcdsaKeyPair,
    spki: Vec<u8>,
}

fn key() -> Key {
    let random = SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &random).unwrap();
    let pair =
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &random).unwrap();
    let mut spki = P256_SPKI_PREFIX.to_vec();
    spki.extend_from_slice(pair.public_key().as_ref());
    Key { pair, spki }
}

fn varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn field(number: u64, value: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    varint(number << 3 | 2, &mut out);
    varint(value.len() as u64, &mut out);
    out.extend_from_slice(value);
    out
}

fn package(signers: &[&Key], developer: &Key, archive: &[u8]) -> Vec<u8> {
    let signed = field(1, &Sha256::digest(&developer.spki)[..16]);
    let mut message = CONTEXT.to_vec();
    message.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    message.extend_from_slice(&signed);
    message.extend_from_slice(archive);
    let mut header = Vec::new();
    for signer in signers {
        let signature = signer.pair.sign(&SystemRandom::new(), &message).unwrap();
        let proof = [field(1, &signer.spki), field(2, signature.as_ref())].concat();
        header.extend(field(3, &proof));
    }
    header.extend(field(10000, &signed));
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&3u32.to_le_bytes());
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend(header);
    bytes.extend_from_slice(archive);
    bytes
}

fn publisher(key: &Key) -> [u8; 32] {
    Sha256::digest(&key.spki).into()
}

#[test]
fn accepts_packages_signed_by_their_developer_and_the_store() {
    let (developer, store) = (key(), key());
    let bytes = package(&[&developer, &store], &developer, b"PK archive");
    let id = id_for(&developer.spki);
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|b| (b'a'..=b'p').contains(&b)));
    assert_eq!(
        verify_with(&bytes, &id, &publisher(&store)).unwrap(),
        b"PK archive"
    );
}

#[test]
fn rejects_packages_the_store_did_not_sign() {
    let (developer, store, other) = (key(), key(), key());
    let bytes = package(&[&developer, &store], &developer, b"archive");
    let id = id_for(&developer.spki);
    assert!(verify_with(&bytes, &id, &publisher(&other))
        .unwrap_err()
        .contains("Chrome Web Store"));
    // Test keys are never the real publisher key.
    assert!(verify(&bytes, &id)
        .unwrap_err()
        .contains("Chrome Web Store"));
}

#[test]
fn rejects_another_extensions_package_and_missing_developer_proofs() {
    let (developer, store, other) = (key(), key(), key());
    let bytes = package(&[&developer, &store], &developer, b"archive");
    assert!(
        verify_with(&bytes, &id_for(&other.spki), &publisher(&store))
            .unwrap_err()
            .contains("identity")
    );
    let unsigned = package(&[&store], &developer, b"archive");
    assert!(
        verify_with(&unsigned, &id_for(&developer.spki), &publisher(&store))
            .unwrap_err()
            .contains("developer")
    );
}

#[test]
fn rejects_tampered_archives_and_malformed_headers() {
    let (developer, store) = (key(), key());
    let id = id_for(&developer.spki);
    let mut bytes = package(&[&developer, &store], &developer, b"archive");
    *bytes.last_mut().unwrap() ^= 1;
    assert!(verify_with(&bytes, &id, &publisher(&store))
        .unwrap_err()
        .contains("signature"));

    let bytes = package(&[&developer, &store], &developer, b"archive");
    let mut wrong_magic = bytes.clone();
    wrong_magic[0] = b'X';
    let mut crx2 = bytes.clone();
    crx2[4] = 2;
    let mut oversized = bytes.clone();
    oversized[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
    for (case, bytes) in [("magic", wrong_magic), ("crx2", crx2), ("size", oversized)] {
        assert!(
            verify_with(&bytes, &id, &publisher(&store)).is_err(),
            "{case}"
        );
    }

    // An end-of-central-directory record hidden in the header is refused.
    let mut header = field(4, b"PK\x05\x06");
    header.extend(field(10000, &field(1, &[0; 16])));
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&3u32.to_le_bytes());
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend(header);
    assert!(verify_with(&bytes, &"a".repeat(32), &publisher(&store)).is_err());
}
