//! History batches: one origin's visits in one hour, as bounded records.
use super::*;

pub(super) type Visit = (String, String, i64, bool);

fn batch_id(origin: &str, hour: i64, part: usize) -> String {
    format!("history:{origin}:{hour}:{part}")
}

/// `(origin, hour)` of a batch record, if it is one.
pub(super) fn batch_of(record: &ViewRecord) -> Option<(String, i64)> {
    if record.kind != Kind::HistoryBatch {
        return None;
    }
    Some((
        record.fields.get("origin")?.as_str()?.to_owned(),
        record.fields.get("hour")?.as_i64()?,
    ))
}

pub(super) fn visits_of(record: &ViewRecord) -> Vec<Visit> {
    record
        .fields
        .get("visits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| {
            Some((
                v.get("url")?.as_str()?.to_owned(),
                v.get("title")?.as_str()?.to_owned(),
                v.get("visited_at")?.as_i64()?,
                v.get("typed")?.as_bool()?,
            ))
        })
        .collect()
}

/// One hour's visits as batch parts of bounded size.
pub(super) fn parts(origin: &str, hour: i64, visits: &[Visit]) -> Vec<ViewRecord> {
    let mut out = Vec::new();
    let mut chunk: Vec<Value> = Vec::new();
    let mut bytes = 0;
    let flush = |chunk: &mut Vec<Value>, out: &mut Vec<ViewRecord>| {
        if chunk.is_empty() {
            return;
        }
        let part = out.len();
        let fields = serde_json::from_value(json!({
            "origin": origin, "hour": hour, "part": part, "visits": std::mem::take(chunk),
        }))
        .unwrap_or_default();
        out.push(ViewRecord {
            kind: Kind::HistoryBatch,
            id: batch_id(origin, hour, part),
            fields,
        });
    };
    for (url, title, visited_at, typed) in visits {
        let visit = json!({"url": url, "title": title, "visited_at": visited_at, "typed": typed});
        let size = visit.to_string().len();
        if bytes + size > PART_BYTES || chunk.len() >= 2000 {
            flush(&mut chunk, &mut out);
            bytes = 0;
        }
        bytes += size;
        chunk.push(visit);
    }
    flush(&mut chunk, &mut out);
    out
}
