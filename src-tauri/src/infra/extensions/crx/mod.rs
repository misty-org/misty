// SPDX-License-Identifier: MIT
//! Chrome Web Store packages (CRX3): header parsing and signature checks,
//! following Chromium's `components/crx_file/crx_verifier.cc`.
//!
//! A package is accepted only when every proof in its header verifies, one
//! proof is the developer key its extension ID derives from, and one is the
//! Chrome Web Store's publisher key. A package the store did not sign, or one
//! signed for another extension ID, never unpacks.
use ring::signature::{self, UnparsedPublicKey};
use sha2::{Digest, Sha256};

const MAGIC: &[u8] = b"Cr24";
const CONTEXT: &[u8] = b"CRX3 SignedData\x00";
/// Headers carry proofs and the store's verified contents; real ones are well under this.
const MAX_HEADER: usize = 16 * 1024 * 1024;
/// SHA-256 of the DER SPKI of the Chrome Web Store's publisher key
/// (`kPublisherKeyHash` in Chromium).
const PUBLISHER_KEY_HASH: [u8; 32] = [
    0x61, 0xf7, 0xf2, 0xa6, 0xbf, 0xcf, 0x74, 0xcd, 0x0b, 0xc1, 0xfe, 0x24, 0x97, 0xcc, 0x9b, 0x04,
    0x25, 0x4c, 0x65, 0x8f, 0x79, 0xf2, 0x14, 0x53, 0x92, 0x86, 0x7e, 0xa8, 0x36, 0x63, 0x67, 0xcf,
];
const RSA_ENCRYPTION: &[u8] = &[0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const EC_PUBLIC_KEY: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const P256: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

/// Returns the ZIP archive inside a store-signed package for `expected_id`.
pub fn verify<'a>(bytes: &'a [u8], expected_id: &str) -> Result<&'a [u8], String> {
    verify_with(bytes, expected_id, &PUBLISHER_KEY_HASH)
}

/// The Chrome extension ID of a DER SPKI public key: the first 128 bits of
/// its SHA-256, written with the letters a–p.
pub fn id_for(public_key: &[u8]) -> String {
    Sha256::digest(public_key)[..16]
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(b'a' + nibble))
        .collect()
}

fn invalid() -> String {
    "The Chrome Web Store package is invalid.".into()
}

fn verify_with<'a>(
    bytes: &'a [u8],
    expected_id: &str,
    publisher: &[u8; 32],
) -> Result<&'a [u8], String> {
    if bytes.len() < 12 || &bytes[..4] != MAGIC {
        return Err(invalid());
    }
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
    if word(4) != 3 {
        return Err("Only CRX3 packages from the Chrome Web Store are supported.".into());
    }
    let size = word(8);
    if size > MAX_HEADER || bytes.len() - 12 < size {
        return Err(invalid());
    }
    let (header, archive) = bytes[12..].split_at(size);
    // A ZIP end record inside the header could make unzipping read the header.
    for token in [b"PK\x05\x06", b"PK\x06\x06", b"PK\x06\x07"] {
        if header.windows(4).any(|window| window == token) {
            return Err(invalid());
        }
    }
    let proofs = fields(header)?;
    let signed = proofs
        .iter()
        .rev()
        .find(|(number, _)| *number == 10000)
        .map(|(_, value)| *value)
        .ok_or_else(invalid)?;
    let crx_id = fields(signed)?
        .into_iter()
        .rev()
        .find(|(number, _)| *number == 1)
        .map(|(_, value)| value)
        .filter(|value| value.len() == 16)
        .ok_or_else(invalid)?;
    let declared: String = crx_id
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(b'a' + nibble))
        .collect();
    if declared != expected_id {
        return Err("The package identity does not match the extension's ID.".into());
    }
    let mut message = Vec::with_capacity(CONTEXT.len() + 4 + signed.len() + archive.len());
    message.extend_from_slice(CONTEXT);
    message.extend_from_slice(&(signed.len() as u32).to_le_bytes());
    message.extend_from_slice(signed);
    message.extend_from_slice(archive);
    let (mut developer, mut store) = (false, false);
    for (number, proof) in &proofs {
        let rsa = match number {
            2 => true,
            3 => false,
            _ => continue,
        };
        let mut key = None;
        let mut signature = None;
        for (field, value) in fields(proof)? {
            match field {
                1 => key = Some(value),
                2 => signature = Some(value),
                _ => {}
            }
        }
        let (Some(key), Some(signature)) = (key, signature) else {
            return Err(invalid());
        };
        developer |= id_for(key) == declared;
        store |= Sha256::digest(key).as_slice() == publisher;
        let (algorithm, point) = public_key(key)?;
        let verified = match (rsa, algorithm) {
            (true, Algorithm::Rsa) => {
                // Older developer keys are 1024-bit and Chromium still accepts them; the
                // store's own key is pinned by hash above, so its proof is what gates trust.
                UnparsedPublicKey::new(
                    &signature::RSA_PKCS1_1024_8192_SHA256_FOR_LEGACY_USE_ONLY,
                    point,
                )
                .verify(&message, signature)
            }
            (false, Algorithm::P256) => {
                UnparsedPublicKey::new(&signature::ECDSA_P256_SHA256_ASN1, point)
                    .verify(&message, signature)
            }
            _ => return Err(invalid()),
        };
        verified.map_err(|_| "The Chrome Web Store package signature is invalid.".to_owned())?;
    }
    if !developer {
        return Err("The package is not signed by its developer.".into());
    }
    if !store {
        return Err("The package is not signed by the Chrome Web Store.".into());
    }
    Ok(archive)
}

/// Length-delimited fields of a protobuf message; other wire types are skipped.
fn fields(mut data: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    let mut out = Vec::new();
    while !data.is_empty() {
        let key = varint(&mut data)?;
        match key & 7 {
            0 => {
                varint(&mut data)?;
            }
            1 => data = data.get(8..).ok_or_else(invalid)?,
            2 => {
                let length = usize::try_from(varint(&mut data)?).map_err(|_| invalid())?;
                if length > data.len() {
                    return Err(invalid());
                }
                let (value, rest) = data.split_at(length);
                out.push((key >> 3, value));
                data = rest;
            }
            5 => data = data.get(4..).ok_or_else(invalid)?,
            _ => return Err(invalid()),
        }
    }
    Ok(out)
}
fn varint(data: &mut &[u8]) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let (&byte, rest) = data.split_first().ok_or_else(invalid)?;
        *data = rest;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(invalid())
}

enum Algorithm {
    Rsa,
    P256,
}

/// Splits a DER SubjectPublicKeyInfo into its algorithm and the key bytes
/// ring expects: PKCS#1 RSAPublicKey for RSA, the uncompressed point for P-256.
fn public_key(spki: &[u8]) -> Result<(Algorithm, &[u8]), String> {
    let (info, rest) = tlv(spki, 0x30)?;
    if !rest.is_empty() {
        return Err(invalid());
    }
    let (identifier, info) = tlv(info, 0x30)?;
    let (bits, rest) = tlv(info, 0x03)?;
    if !rest.is_empty() || bits.first() != Some(&0) {
        return Err(invalid());
    }
    let (oid, parameters) = tlv(identifier, 0x06)?;
    let algorithm = if oid == RSA_ENCRYPTION {
        Algorithm::Rsa
    } else if oid == EC_PUBLIC_KEY && tlv(parameters, 0x06).is_ok_and(|(curve, _)| curve == P256) {
        Algorithm::P256
    } else {
        return Err("The package uses an unsupported signing key.".into());
    };
    Ok((algorithm, &bits[1..]))
}

/// One DER element with the given tag: its contents and what follows it.
fn tlv(data: &[u8], tag: u8) -> Result<(&[u8], &[u8]), String> {
    let (&found, data) = data.split_first().ok_or_else(invalid)?;
    let (&first, mut data) = data.split_first().ok_or_else(invalid)?;
    if found != tag {
        return Err(invalid());
    }
    let length = if first < 0x80 {
        usize::from(first)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || data.len() < count {
            return Err(invalid());
        }
        let (octets, rest) = data.split_at(count);
        data = rest;
        octets
            .iter()
            .fold(0usize, |value, octet| (value << 8) | usize::from(*octet))
    };
    if length > data.len() {
        return Err(invalid());
    }
    Ok(data.split_at(length))
}

#[cfg(test)]
mod tests;
