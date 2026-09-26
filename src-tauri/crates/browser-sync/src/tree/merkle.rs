//! Tree Merkle root over every non-root node and slot: `(id, parent, version,
//! ciphertext hash)`. The root node carries it (encrypted) and every op signs
//! it, so a server that hides a node or serves an old-but-authentic one is
//! detected when the client recomputes the root.
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Leaf {
    Node { node_id: String, parent_id: String, version: u64, hash: [u8; 32] },
    Slot { tab_node_id: String, slot: i16, version: u64, hash: [u8; 32] },
}

impl Leaf {
    fn digest(&self) -> [u8; 32] {
        let encoded = match self {
            Leaf::Node { node_id, parent_id, version, hash } => {
                serde_json::to_vec(&("n", node_id, parent_id, version, STANDARD.encode(hash)))
            }
            Leaf::Slot { tab_node_id, slot, version, hash } => {
                serde_json::to_vec(&("s", tab_node_id, slot, version, STANDARD.encode(hash)))
            }
        }
        .expect("leaf encoding is infallible");
        let mut h = Sha256::new();
        h.update([0u8]);
        h.update(encoded);
        h.finalize().into()
    }
}

/// Leaves are sorted so every client computes the same root regardless of
/// arrival order. Internal nodes are domain-separated from leaves.
pub fn root(mut leaves: Vec<Leaf>) -> [u8; 32] {
    leaves.sort();
    let mut level: Vec<[u8; 32]> = leaves.iter().map(Leaf::digest).collect();
    if level.is_empty() {
        return Sha256::digest(b"misty.sync.merkle.empty.v2").into();
    }
    while level.len() > 1 {
        level = level
            .chunks(2)
            .map(|pair| match pair {
                [left, right] => {
                    let mut h = Sha256::new();
                    h.update([1u8]);
                    h.update(left);
                    h.update(right);
                    h.finalize().into()
                }
                [single] => *single,
                _ => unreachable!(),
            })
            .collect();
    }
    level[0]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, version: u64) -> Leaf {
        Leaf::Node { node_id: id.into(), parent_id: "p".into(), version, hash: [7; 32] }
    }

    #[test]
    fn order_independent_and_sensitive_to_every_leaf() {
        let a = root(vec![node("a", 1), node("b", 1), node("c", 1)]);
        assert_eq!(a, root(vec![node("c", 1), node("a", 1), node("b", 1)]));
        assert_ne!(a, root(vec![node("a", 1), node("b", 1)]), "hidden node");
        assert_ne!(a, root(vec![node("a", 1), node("b", 1), node("c", 2)]), "rolled-back version");
        let slot = Leaf::Slot { tab_node_id: "a".into(), slot: 2, version: 1, hash: [7; 32] };
        assert_ne!(a, root(vec![node("a", 1), node("b", 1), node("c", 1), slot]));
    }
}
