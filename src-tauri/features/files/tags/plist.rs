// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! The one binary property list Finder tags need: an array of strings, read and written.

pub(super) fn parse_strings(data: &[u8]) -> Option<Vec<String>> {
    if data.len() < 40 || &data[..8] != b"bplist00" {
        return None;
    }
    let trailer = &data[data.len() - 32..];
    let offset_size = trailer[6] as usize;
    let ref_size = trailer[7] as usize;
    let object_count = read_uint(&trailer[8..16])?;
    let top_object = read_uint(&trailer[16..24])?;
    let table_offset = read_uint(&trailer[24..32])?;
    let object_offset = |index: usize| -> Option<usize> {
        if index >= object_count {
            return None;
        }
        let start = table_offset.checked_add(index.checked_mul(offset_size)?)?;
        read_uint(data.get(start..start.checked_add(offset_size)?)?)
    };
    let (marker, count, body) = object_header(data, object_offset(top_object)?)?;
    if marker != 0xA {
        return None;
    }
    (0..count)
        .map(|position| {
            let start = body.checked_add(position.checked_mul(ref_size)?)?;
            let index = read_uint(data.get(start..start.checked_add(ref_size)?)?)?;
            let (marker, length, body) = object_header(data, object_offset(index)?)?;
            match marker {
                0x5 => Some(
                    String::from_utf8_lossy(data.get(body..body.checked_add(length)?)?)
                        .into_owned(),
                ),
                0x6 => {
                    let units: Vec<u16> = data
                        .get(body..body.checked_add(length.checked_mul(2)?)?)?
                        .chunks_exact(2)
                        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                        .collect();
                    Some(String::from_utf16_lossy(&units))
                }
                _ => None,
            }
        })
        .collect()
}

fn object_header(data: &[u8], offset: usize) -> Option<(u8, usize, usize)> {
    let byte = *data.get(offset)?;
    let (marker, low) = (byte >> 4, (byte & 0x0F) as usize);
    if low != 0x0F {
        return Some((marker, low, offset + 1));
    }
    let int_marker = *data.get(offset + 1)?;
    if int_marker >> 4 != 0x1 {
        return None;
    }
    let width = 1usize << (int_marker & 0x0F);
    let length = read_uint(data.get(offset + 2..offset + 2 + width)?)?;
    Some((marker, length, offset + 2 + width))
}

fn read_uint(bytes: &[u8]) -> Option<usize> {
    if bytes.is_empty() || bytes.len() > 8 {
        return None;
    }
    Some(
        bytes
            .iter()
            .fold(0u64, |value, byte| (value << 8) | *byte as u64) as usize,
    )
}

pub(super) fn write_strings(strings: &[String]) -> Vec<u8> {
    let count = strings.len() + 1;
    let ref_size = if count <= 0xFF { 1 } else { 2 };
    let mut data = b"bplist00".to_vec();
    let mut offsets = Vec::with_capacity(count);
    offsets.push(data.len());
    write_header(&mut data, 0xA, strings.len());
    for index in 1..count {
        push_uint(&mut data, index as u64, ref_size);
    }
    for text in strings {
        offsets.push(data.len());
        if text.is_ascii() {
            write_header(&mut data, 0x5, text.len());
            data.extend_from_slice(text.as_bytes());
        } else {
            let units: Vec<u16> = text.encode_utf16().collect();
            write_header(&mut data, 0x6, units.len());
            for unit in units {
                data.extend_from_slice(&unit.to_be_bytes());
            }
        }
    }
    let table_offset = data.len();
    let offset_size = width_for(table_offset as u64);
    for offset in &offsets {
        push_uint(&mut data, *offset as u64, offset_size);
    }
    data.extend_from_slice(&[0; 6]);
    data.push(offset_size as u8);
    data.push(ref_size as u8);
    data.extend_from_slice(&(count as u64).to_be_bytes());
    data.extend_from_slice(&0u64.to_be_bytes());
    data.extend_from_slice(&(table_offset as u64).to_be_bytes());
    data
}

fn write_header(data: &mut Vec<u8>, marker: u8, length: usize) {
    if length < 0x0F {
        data.push((marker << 4) | length as u8);
        return;
    }
    data.push((marker << 4) | 0x0F);
    let width = width_for(length as u64);
    data.push(0x10 | width.trailing_zeros() as u8);
    push_uint(data, length as u64, width);
}

fn width_for(value: u64) -> usize {
    match value {
        0..=0xFF => 1,
        0x100..=0xFFFF => 2,
        0x1_0000..=0xFFFF_FFFF => 4,
        _ => 8,
    }
}

fn push_uint(data: &mut Vec<u8>, value: u64, width: usize) {
    data.extend_from_slice(&value.to_be_bytes()[8 - width..]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finders_plist() -> Vec<u8> {
        let mut data = b"bplist00".to_vec();
        let array_offset = data.len();
        data.extend([0xA2, 1, 2]);
        let red_offset = data.len();
        data.push(0x55);
        data.extend(b"Red\n6");
        let projects_offset = data.len();
        data.push(0x58);
        data.extend(b"Projects");
        let table_offset = data.len();
        data.extend([array_offset as u8, red_offset as u8, projects_offset as u8]);
        let mut trailer = vec![0u8; 6];
        trailer.extend([1, 1]);
        trailer.extend(3u64.to_be_bytes());
        trailer.extend(0u64.to_be_bytes());
        trailer.extend((table_offset as u64).to_be_bytes());
        data.extend(trailer);
        data
    }

    #[test]
    fn reads_finders_own_plist_and_writes_the_same_bytes() {
        let strings = vec!["Red\n6".to_owned(), "Projects".to_owned()];
        assert_eq!(parse_strings(&finders_plist()), Some(strings.clone()));
        assert_eq!(write_strings(&strings), finders_plist());
    }

    #[test]
    fn long_and_many_strings_round_trip() {
        let strings: Vec<String> = (0..300)
            .map(|n| format!("Tag number {n} with a long name"))
            .collect();
        assert_eq!(parse_strings(&write_strings(&strings)), Some(strings));
        assert_eq!(parse_strings(&write_strings(&[])), Some(Vec::new()));
    }

    #[test]
    fn rejects_malformed_data() {
        assert_eq!(parse_strings(b"not a plist"), None);
        let mut truncated = finders_plist();
        truncated.truncate(30);
        assert_eq!(parse_strings(&truncated), None);
    }
}
