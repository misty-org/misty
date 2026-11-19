//! What is in a picture, from the computer's own image classifier (Apple's Vision on macOS), for
//! the video editor's footage analysis: the labels of a scene's frame (person, food, outdoor).
//! Nothing leaves the computer. Elsewhere it isn't offered, and the analysis leaves labels out.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

#[cfg(target_os = "macos")]
use super::classify_macos;
use super::person_window;

/// The largest picture sent to be classified. The editor sends small JPEG frames.
const MAX_CLASSIFY_BYTES: usize = 32 * 1024 * 1024;
/// Labels less sure than this are left out.
const MIN_CONFIDENCE: f32 = 0.2;
/// The most labels one picture answers with.
const MAX_LABELS: usize = 10;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ImageLabel {
    pub label: String,
    pub confidence: f32,
}

/// The surest labels, surest first: at most `MAX_LABELS`, none under `MIN_CONFIDENCE`.
fn strongest(labels: Vec<(String, f32)>) -> Vec<ImageLabel> {
    let mut kept: Vec<ImageLabel> = labels
        .into_iter()
        .filter(|(label, confidence)| {
            !label.is_empty() && confidence.is_finite() && *confidence >= MIN_CONFIDENCE
        })
        .map(|(label, confidence)| ImageLabel {
            label: label.replace('_', " "),
            confidence: confidence.min(1.0),
        })
        .collect();
    kept.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    kept.truncate(MAX_LABELS);
    kept
}

/// Whether this computer can say what is in a picture, so the analysis asks only there.
#[tauri::command]
pub fn image_classify_supported() -> bool {
    #[cfg(target_os = "macos")]
    return classify_macos::supported();
    #[cfg(not(target_os = "macos"))]
    false
}

/// The labels of the picture sent as the body (PNG or JPEG bytes), surest first.
#[tauri::command]
pub async fn image_classify(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<ImageLabel>, String> {
    person_window(&webview)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture didn't arrive.".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_CLASSIFY_BYTES {
        return Err("That picture is too large to recognize.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let bytes = bytes.clone();
        let labels = tokio::task::spawn_blocking(move || classify_macos::classify(&bytes))
            .await
            .map_err(|error| error.to_string())??;
        Ok(strongest(labels))
    }
    #[cfg(not(target_os = "macos"))]
    Err("Recognizing what's in a picture needs macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(name: &str, confidence: f32) -> (String, f32) {
        (name.to_owned(), confidence)
    }

    #[test]
    fn keeps_the_surest_labels_first() {
        let kept = strongest(vec![
            label("outdoor", 0.4),
            label("food", 0.9),
            label("blurry", 0.1),
        ]);
        let names: Vec<&str> = kept.iter().map(|each| each.label.as_str()).collect();
        assert_eq!(names, ["food", "outdoor"]);
    }

    #[test]
    fn drops_unreadable_labels_and_caps_the_list() {
        let mut labels = vec![label("", 0.9), label("nothing", f32::NAN)];
        labels.extend((0..20).map(|index| label(&format!("thing_{index}"), 0.5)));
        let kept = strongest(labels);
        assert_eq!(kept.len(), MAX_LABELS);
        assert!(kept.iter().all(|each| each.label.starts_with("thing ")));
    }
}
