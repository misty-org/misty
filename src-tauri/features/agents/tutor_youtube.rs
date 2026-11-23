use crate::agents::web_fetch::fetch_raw;

use super::{readable_type, ReadLink, PAGE_BYTES};

pub(super) fn youtube_id(url: &url::Url) -> Option<String> {
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let id = match host {
        "youtu.be" => url.path_segments()?.next()?.to_owned(),
        "youtube.com" | "music.youtube.com" => {
            let mut segments = url.path_segments()?;
            match segments.next()? {
                "watch" => url
                    .query_pairs()
                    .find(|(key, _)| key == "v")?
                    .1
                    .into_owned(),
                "shorts" | "embed" | "live" => segments.next()?.to_owned(),
                _ => return None,
            }
        }
        _ => return None,
    };
    let valid = !id.is_empty()
        && id.len() <= 20
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then_some(id)
}

pub(super) async fn video(id: &str) -> Result<ReadLink, String> {
    let watch = format!("https://www.youtube.com/watch?v={id}&hl=en");
    let response = fetch_raw(&watch, "text/html", PAGE_BYTES, readable_type)
        .await
        .map_err(|_| "Misty couldn't reach YouTube.".to_owned())?;
    let html = String::from_utf8_lossy(&response.body);
    let title = page_title(&html).unwrap_or_else(|| "YouTube video".to_owned());
    let Some(track) = caption_track(&html) else {
        return Err("This video has no captions Misty can read.".into());
    };
    let captions = fetch_raw(
        &track,
        "text/xml,application/xml",
        PAGE_BYTES,
        readable_type,
    )
    .await
    .map_err(|_| "Misty couldn't fetch the video's captions.".to_owned())?;
    let lines = caption_lines(&String::from_utf8_lossy(&captions.body));
    if lines.is_empty() {
        return Err("YouTube didn't hand over this video's captions.".into());
    }
    Ok(ReadLink {
        title,
        text: lines.join("\n"),
        kind: "video",
        truncated: captions.truncated,
    })
}

fn page_title(html: &str) -> Option<String> {
    let start = html.find("<title>")? + "<title>".len();
    let end = start + html[start..].find("</title>")?;
    let title = decode_entities(html[start..end].trim());
    let title = title.trim_end_matches(" - YouTube").trim().to_owned();
    (!title.is_empty()).then_some(title)
}

fn caption_track(html: &str) -> Option<String> {
    let at = html.find("\"captionTracks\":")? + "\"captionTracks\":".len();
    let rest = &html[at..];
    let mut depth = 0usize;
    let mut end = None;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in rest.char_indices() {
        if in_string {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    end = Some(index + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let tracks: Vec<serde_json::Value> = serde_json::from_str(&rest[..end?]).ok()?;
    let language = |track: &serde_json::Value| {
        track
            .get("languageCode")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_owned()
    };
    let automatic = |track: &serde_json::Value| {
        track.get("kind").and_then(|value| value.as_str()) == Some("asr")
    };
    let pick = tracks
        .iter()
        .find(|track| language(track).starts_with("en") && !automatic(track))
        .or_else(|| {
            tracks
                .iter()
                .find(|track| language(track).starts_with("en"))
        })
        .or_else(|| tracks.iter().find(|track| !automatic(track)))
        .or_else(|| tracks.first())?;
    let base = pick.get("baseUrl")?.as_str()?;
    let parsed = url::Url::parse(base).ok()?;
    let host = parsed.host_str()?;
    (host == "www.youtube.com" || host == "youtube.com").then(|| base.to_owned())
}

fn caption_lines(xml: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut rest = xml;
    while let Some(open) = rest.find("<text") {
        let after = &rest[open..];
        let Some(close_tag) = after.find('>') else {
            break;
        };
        let attributes = &after[..close_tag];
        let Some(end) = after.find("</text>") else {
            break;
        };
        let body = &after[close_tag + 1..end];
        let start = attributes
            .split("start=\"")
            .nth(1)
            .and_then(|value| value.split('"').next())
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0);
        let text = decode_entities(&decode_entities(body)).replace('\n', " ");
        let text = text.trim();
        if !text.is_empty() {
            let seconds = start as u64;
            lines.push(format!("[{}:{:02}] {}", seconds / 60, seconds % 60, text));
        }
        rest = &after[end + "</text>".len()..];
    }
    lines
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(semi) = tail.find(';').filter(|semi| *semi <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..semi];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if name.starts_with("#x") => u32::from_str_radix(&name[2..], 16)
                .ok()
                .and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(character) => {
                out.push(character);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_video_id_in_every_kind_of_youtube_link() {
        let id = |address: &str| youtube_id(&url::Url::parse(address).unwrap());
        assert_eq!(
            id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(
            id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(
            id("https://m.youtube.com/shorts/abc_DEF-123"),
            Some("abc_DEF-123".into())
        );
        assert_eq!(id("https://www.youtube.com/@channel"), None);
        assert_eq!(id("https://example.com/watch?v=x"), None);
    }

    #[test]
    fn picks_english_written_captions_from_the_player_data() {
        let html = r#"var x = {"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=de","languageCode":"de"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en&kind=asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","languageCode":"en","name":{"simpleText":"English [CC]"}}],"audioTracks":[]}"#;
        assert_eq!(
            caption_track(html).as_deref(),
            Some("https://www.youtube.com/api/timedtext?v=1&lang=en")
        );
        let elsewhere =
            r#"{"captionTracks":[{"baseUrl":"https://evil.example/x","languageCode":"en"}]}"#;
        assert_eq!(caption_track(elsewhere), None);
    }

    #[test]
    fn reads_timed_captions_with_their_times_and_entities() {
        let xml = r#"<?xml version="1.0"?><transcript><text start="0.5" dur="2">Hello &amp;amp; welcome</text><text start="75.2" dur="1">it&amp;#39;s &lt;fine&gt;</text><text start="80" dur="1"> </text></transcript>"#;
        assert_eq!(
            caption_lines(xml),
            vec!["[0:00] Hello & welcome", "[1:15] it's <fine>"]
        );
    }
}
