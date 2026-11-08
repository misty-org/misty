//! Ids for parts a provider doesn't name. The same form as the SDK's `generateId`.
use rand::Rng;

const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

pub(crate) fn generate_id() -> String {
    let mut random = rand::thread_rng();
    (0..16)
        .map(|_| char::from(ALPHABET[random.gen_range(0..ALPHABET.len())]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_have_the_sdk_form_and_differ() {
        let one = generate_id();
        assert_eq!(one.len(), 16);
        assert!(one.chars().all(|character| character.is_ascii_alphanumeric()));
        assert_ne!(one, generate_id());
    }
}
