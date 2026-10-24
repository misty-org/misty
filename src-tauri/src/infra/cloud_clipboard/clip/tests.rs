use super::*;
use crate::domain::clipboard::ClipboardFileRef;

const SOURCE: Source<'static> = Source {
    device_id: "device-a",
    device_name: "Desk",
};

fn payload(kind: ClipboardPayloadKind) -> ClipboardPayload {
    ClipboardPayload {
        kind,
        revision: 3,
        created_unix_ms: 1_700_000_000_000,
        ..ClipboardPayload::default()
    }
}

#[test]
fn text_round_trips_and_long_text_is_cut_to_fit() {
    let mut copy = payload(ClipboardPayloadKind::Html);
    copy.text = "hello wörld".into();
    copy.html = "<b>hello</b>".into();
    let (clip, body) = from_payload(&copy, &SOURCE, 1000).unwrap();
    assert_eq!(decode(&body).unwrap(), clip);
    assert_eq!(clip.header.device_name, "Desk");

    // Random text barely compresses: it is cut, never refused.
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let random: String = (0..400_000)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            char::from(b'a' + (state % 26) as u8)
        })
        .collect();
    copy.text = random;
    let (clip, body) = from_payload(&copy, &SOURCE, 20_000).unwrap();
    assert!(body.len() <= 20_000);
    assert!(clip.header.html.is_empty() && !clip.header.text.is_empty());
}

#[test]
fn files_cross_as_names() {
    let mut copy = payload(ClipboardPayloadKind::FileRefs);
    copy.file_refs = vec![ClipboardFileRef {
        display_name: "report.pdf".into(),
        ..ClipboardFileRef::default()
    }];
    let (clip, _) = from_payload(&copy, &SOURCE, 1000).unwrap();
    assert_eq!(clip.header.kind, ClipboardPayloadKind::Text);
    assert_eq!(clip.header.text, "report.pdf");
    assert_eq!(clip.header.file_names, vec!["report.pdf".to_owned()]);
}

#[test]
fn large_images_shrink_until_they_fit() {
    // A noisy image that PNG cannot compress well.
    let noisy = image::RgbaImage::from_fn(900, 700, |x, y| {
        let v = ((x * 31 + y * 17) ^ (x * y)) as u8;
        image::Rgba([v, v.wrapping_mul(3), v.wrapping_add(91), 255])
    });
    let png = encode_image(
        &image::DynamicImage::ImageRgba8(noisy),
        image::ImageFormat::Png,
    )
    .unwrap();
    let mut copy = payload(ClipboardPayloadKind::Image);
    copy.images = vec![ClipboardImage {
        mime_type: "image/png".into(),
        blob_id: String::new(),
        checksum: String::new(),
        size_bytes: png.len() as u64,
        width: 900,
        height: 700,
        bytes: png,
    }];
    let capacity = 100 * 1024;
    let (clip, body) = from_payload(&copy, &SOURCE, capacity).unwrap();
    assert!(body.len() <= capacity);
    let meta = clip.header.image.clone().unwrap();
    assert!(meta.width <= 900 && meta.height <= 700);
    let opened = decode(&body).unwrap();
    assert!(image::load_from_memory(&opened.image).is_ok());
    assert_eq!(
        from_payload(&copy, &SOURCE, 200).unwrap_err(),
        ClipError::TooLarge
    );
}

#[test]
fn hostile_bodies_are_refused() {
    assert_eq!(decode(b"not zstd").unwrap_err(), ClipError::Invalid);
    // A body that expands far past the limit.
    let bomb = zstd::bulk::compress(&vec![0u8; MAX_OPENED_BYTES + 10], 3).unwrap();
    assert_eq!(decode(&bomb).unwrap_err(), ClipError::Invalid);
    assert_eq!(
        from_payload(&payload(ClipboardPayloadKind::Empty), &SOURCE, 1000).unwrap_err(),
        ClipError::Empty
    );
}
