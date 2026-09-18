use super::{ClipboardCache, ClipboardImageBlobCacheKey, ClipboardRemoteFileCacheKey};

impl ClipboardCache {
    pub fn remote_file_key(key: &ClipboardRemoteFileCacheKey) -> String {
        let input = format!(
            "remote-file\n{}\n{}\n{}\n{}\n{}\n",
            key.remote_name,
            key.remote_path,
            key.size,
            key.last_modified,
            i32::from(key.is_dir)
        );
        format!("{:016x}", xxh64(input.as_bytes(), 0))
    }

    pub fn image_blob_key(key: &ClipboardImageBlobCacheKey) -> String {
        let input = format!(
            "image-blob\n{}\n{}\n{}\n{}\n",
            key.blob_id, key.checksum, key.size_bytes, key.mime_type
        );
        format!("{:016x}", xxh64(input.as_bytes(), 0))
    }
}

pub(super) fn xxh64(input: &[u8], seed: u64) -> u64 {
    const PRIME1: u64 = 11_400_714_785_074_694_791;
    const PRIME2: u64 = 14_029_467_366_897_019_727;
    const PRIME3: u64 = 1_609_587_929_392_839_161;
    const PRIME4: u64 = 9_650_029_242_287_828_579;
    const PRIME5: u64 = 2_870_177_450_012_600_261;

    fn round(mut accumulator: u64, lane: u64) -> u64 {
        const PRIME1: u64 = 11_400_714_785_074_694_791;
        const PRIME2: u64 = 14_029_467_366_897_019_727;
        accumulator = accumulator.wrapping_add(lane.wrapping_mul(PRIME2));
        accumulator = accumulator.rotate_left(31);
        accumulator.wrapping_mul(PRIME1)
    }

    fn merge_round(mut accumulator: u64, value: u64) -> u64 {
        const PRIME1: u64 = 11_400_714_785_074_694_791;
        const PRIME4: u64 = 9_650_029_242_287_828_579;
        accumulator ^= round(0, value);
        accumulator = accumulator.wrapping_mul(PRIME1).wrapping_add(PRIME4);
        accumulator
    }

    let mut offset = 0usize;
    let mut hash = if input.len() >= 32 {
        let mut v1 = seed.wrapping_add(PRIME1).wrapping_add(PRIME2);
        let mut v2 = seed.wrapping_add(PRIME2);
        let mut v3 = seed;
        let mut v4 = seed.wrapping_sub(PRIME1);
        while offset <= input.len() - 32 {
            v1 = round(
                v1,
                u64::from_le_bytes(input[offset..offset + 8].try_into().unwrap()),
            );
            v2 = round(
                v2,
                u64::from_le_bytes(input[offset + 8..offset + 16].try_into().unwrap()),
            );
            v3 = round(
                v3,
                u64::from_le_bytes(input[offset + 16..offset + 24].try_into().unwrap()),
            );
            v4 = round(
                v4,
                u64::from_le_bytes(input[offset + 24..offset + 32].try_into().unwrap()),
            );
            offset += 32;
        }
        let mut hash = v1
            .rotate_left(1)
            .wrapping_add(v2.rotate_left(7))
            .wrapping_add(v3.rotate_left(12))
            .wrapping_add(v4.rotate_left(18));
        hash = merge_round(hash, v1);
        hash = merge_round(hash, v2);
        hash = merge_round(hash, v3);
        merge_round(hash, v4)
    } else {
        seed.wrapping_add(PRIME5)
    };

    hash = hash.wrapping_add(input.len() as u64);
    while offset + 8 <= input.len() {
        let lane = u64::from_le_bytes(input[offset..offset + 8].try_into().unwrap());
        hash ^= round(0, lane);
        hash = hash
            .rotate_left(27)
            .wrapping_mul(PRIME1)
            .wrapping_add(PRIME4);
        offset += 8;
    }
    if offset + 4 <= input.len() {
        let lane = u32::from_le_bytes(input[offset..offset + 4].try_into().unwrap()) as u64;
        hash ^= lane.wrapping_mul(PRIME1);
        hash = hash
            .rotate_left(23)
            .wrapping_mul(PRIME2)
            .wrapping_add(PRIME3);
        offset += 4;
    }
    while offset < input.len() {
        hash ^= (input[offset] as u64).wrapping_mul(PRIME5);
        hash = hash.rotate_left(11).wrapping_mul(PRIME1);
        offset += 1;
    }
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(PRIME2);
    hash ^= hash >> 29;
    hash = hash.wrapping_mul(PRIME3);
    hash ^ (hash >> 32)
}
