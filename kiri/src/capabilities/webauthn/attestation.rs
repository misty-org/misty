//! Reads the attestation object an authenticator returns, so the page gets
//! `getAuthenticatorData()`, `getPublicKey()` and `getPublicKeyAlgorithm()`
//! like it would in a full browser.

use super::options::{EDDSA, ES256, RS256};
use ciborium::Value;

pub(super) struct Attested {
    pub authenticator_data: Vec<u8>,
    /// SubjectPublicKeyInfo DER, when the algorithm is one Kiri can encode.
    pub public_key: Option<Vec<u8>>,
    pub algorithm: Option<i64>,
}

fn text_key<'a>(map: &'a [(Value, Value)], key: &str) -> Option<&'a Value> {
    map.iter()
        .find(|(name, _)| matches!(name, Value::Text(text) if text == key))
        .map(|(_, value)| value)
}

fn int_key(map: &[(Value, Value)], key: i64) -> Option<&Value> {
    map.iter()
        .find(|(name, _)| matches!(name, Value::Integer(value) if i128::from(*value) == i128::from(key)))
        .map(|(_, value)| value)
}

fn int(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Integer(value) => i64::try_from(i128::from(*value)).ok(),
        _ => None,
    }
}

fn bytes(value: Option<&Value>) -> Option<&[u8]> {
    match value? {
        Value::Bytes(bytes) => Some(bytes),
        _ => None,
    }
}

pub(super) fn read(attestation_object: &[u8]) -> Option<Attested> {
    let Value::Map(object) = ciborium::from_reader::<Value, _>(attestation_object).ok()? else {
        return None;
    };
    let authenticator_data = bytes(text_key(&object, "authData"))?.to_vec();
    let (public_key, algorithm) = credential_key(&authenticator_data).unwrap_or((None, None));
    Some(Attested {
        authenticator_data,
        public_key,
        algorithm,
    })
}

/// rpIdHash(32) flags(1) signCount(4) aaguid(16) idLength(2) id(n) COSE key.
fn credential_key(data: &[u8]) -> Option<(Option<Vec<u8>>, Option<i64>)> {
    const ATTESTED: u8 = 0x40;
    if data.get(32)? & ATTESTED == 0 {
        return None;
    }
    let length = u16::from_be_bytes([*data.get(53)?, *data.get(54)?]) as usize;
    let key = data.get(55 + length..)?;
    let Value::Map(cose) = ciborium::from_reader::<Value, _>(key).ok()? else {
        return None;
    };
    let algorithm = int(int_key(&cose, 3));
    Some((spki(&cose, algorithm?), algorithm))
}

fn spki(cose: &[(Value, Value)], algorithm: i64) -> Option<Vec<u8>> {
    match algorithm {
        ES256 => {
            let (x, y) = (bytes(int_key(cose, -2))?, bytes(int_key(cose, -3))?);
            if x.len() != 32 || y.len() != 32 {
                return None;
            }
            // SEQUENCE { id-ecPublicKey, prime256v1 } BIT STRING 04 || x || y
            let mut der = hex("3059301306072a8648ce3d020106082a8648ce3d03010703420004");
            der.extend_from_slice(x);
            der.extend_from_slice(y);
            Some(der)
        }
        EDDSA => {
            let x = bytes(int_key(cose, -2))?;
            if x.len() != 32 {
                return None;
            }
            let mut der = hex("302a300506032b6570032100");
            der.extend_from_slice(x);
            Some(der)
        }
        RS256 => {
            let (n, e) = (bytes(int_key(cose, -1))?, bytes(int_key(cose, -2))?);
            let key = der(0x30, &[der_integer(n), der_integer(e)].concat());
            let mut bit_string = vec![0];
            bit_string.extend_from_slice(&key);
            // SEQUENCE { rsaEncryption, NULL }
            let algorithm = hex("300d06092a864886f70d0101010500");
            Some(der(0x30, &[algorithm, der(0x03, &bit_string)].concat()))
        }
        _ => None,
    }
}

fn der(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let length = content.len();
    if length < 0x80 {
        out.push(length as u8);
    } else {
        let bytes: Vec<u8> = length.to_be_bytes().into_iter().skip_while(|byte| *byte == 0).collect();
        out.push(0x80 | bytes.len() as u8);
        out.extend(bytes);
    }
    out.extend_from_slice(content);
    out
}

fn der_integer(magnitude: &[u8]) -> Vec<u8> {
    let trimmed: Vec<u8> = magnitude.iter().copied().skip_while(|byte| *byte == 0).collect();
    let mut content = if trimmed.first().is_some_and(|byte| byte & 0x80 != 0) {
        vec![0]
    } else {
        Vec::new()
    };
    content.extend(if trimmed.is_empty() { vec![0] } else { trimmed });
    der(0x02, &content)
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).expect("static hex"))
        .collect()
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// An attestation object holding one ES256 credential.
    pub(crate) fn es256_attestation(credential_id: &[u8]) -> Vec<u8> {
        let key = Value::Map(vec![
            (Value::Integer(1.into()), Value::Integer(2.into())),
            (Value::Integer(3.into()), Value::Integer(ES256.into())),
            (Value::Integer((-1).into()), Value::Integer(1.into())),
            (Value::Integer((-2).into()), Value::Bytes(vec![0x11; 32])),
            (Value::Integer((-3).into()), Value::Bytes(vec![0x22; 32])),
        ]);
        let mut data = vec![0xaa; 32];
        data.push(0x45); // UP | UV | AT
        data.extend([0, 0, 0, 0]);
        data.extend([0; 16]);
        data.extend((credential_id.len() as u16).to_be_bytes());
        data.extend_from_slice(credential_id);
        ciborium::into_writer(&key, &mut data).unwrap();
        let object = Value::Map(vec![
            (Value::Text("fmt".into()), Value::Text("none".into())),
            (Value::Text("attStmt".into()), Value::Map(vec![])),
            (Value::Text("authData".into()), Value::Bytes(data)),
        ]);
        let mut out = Vec::new();
        ciborium::into_writer(&object, &mut out).unwrap();
        out
    }

    #[test]
    fn es256_keys_become_subject_public_key_info() {
        let attested = read(&es256_attestation(b"credential")).unwrap();
        assert_eq!(attested.algorithm, Some(ES256));
        let key = attested.public_key.unwrap();
        assert_eq!(key.len(), 91);
        assert_eq!(&key[..2], &[0x30, 0x59]);
        assert_eq!(&key[27..], &[[0x11; 32], [0x22; 32]].concat()[..]);
        assert_eq!(attested.authenticator_data[32], 0x45);
    }

    #[test]
    fn data_without_an_attested_credential_has_no_key() {
        let mut data = vec![0; 37];
        data[32] = 0x01;
        let object = Value::Map(vec![(Value::Text("authData".into()), Value::Bytes(data.clone()))]);
        let mut raw = Vec::new();
        ciborium::into_writer(&object, &mut raw).unwrap();
        let attested = read(&raw).unwrap();
        assert_eq!(attested.authenticator_data, data);
        assert!(attested.public_key.is_none());
    }

    #[test]
    fn rsa_integers_stay_positive() {
        let encoded = der_integer(&[0x80, 0x01]);
        assert_eq!(encoded, vec![0x02, 0x03, 0x00, 0x80, 0x01]);
        assert_eq!(der(0x30, &[0; 200])[..3], [0x30, 0x81, 200]);
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(read(b"not cbor").is_none());
    }
}
