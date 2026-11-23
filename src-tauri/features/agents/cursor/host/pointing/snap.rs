#[cfg(target_os = "macos")]
pub fn snap_point(x: f64, y: f64, label: &str) -> Result<Option<serde_json::Value>, String> {
    let value = crate::agents::cursor::macos::companion_pointing::snap_point(x, y, label);
    if value["error"].is_string() {
        return Ok(None);
    }
    Ok(value.get("element").cloned())
}

#[cfg(target_os = "linux")]
pub fn snap_point(_x: f64, _y: f64, _label: &str) -> Result<Option<serde_json::Value>, String> {
    Ok(None)
}

#[cfg(windows)]
pub fn snap_point(x: f64, y: f64, label: &str) -> Result<Option<serde_json::Value>, String> {
    use crate::app::windows::automation::{is_target_role, Automation, Element};
    let Ok(automation) = Automation::new() else {
        return Ok(None);
    };
    let words = label_words(label);
    let mut offsets = vec![(0.0, 0.0)];
    for radius in [14.0, 32.0] {
        for step in 0..8 {
            let angle = f64::from(step) * std::f64::consts::FRAC_PI_4;
            offsets.push((angle.cos() * radius, angle.sin() * radius));
        }
    }
    let mut seen: Vec<Element> = Vec::new();
    let mut best: Option<(f64, f64, serde_json::Value)> = None;
    for (dx, dy) in offsets {
        let Some(mut current) =
            automation.element_at((x + dx).round() as i32, (y + dy).round() as i32)
        else {
            continue;
        };
        for _ in 0..5 {
            let role = current.role();
            if role == "Window" {
                break;
            }
            let bounds = current.bounds().filter(|frame| {
                frame.width >= 4.0
                    && frame.height >= 4.0
                    && frame.width <= 480.0
                    && frame.height <= 240.0
            });
            if let Some(frame) = bounds.filter(|_| is_target_role(role) || current.pressable()) {
                if seen.iter().any(|other| other.same_as(&current)) {
                    break;
                }
                let description = current.description().to_lowercase();
                let matched = words
                    .iter()
                    .filter(|word| description.contains(word.as_str()))
                    .count();
                let score = if words.is_empty() {
                    0.0
                } else {
                    matched as f64 / words.len() as f64
                };
                let (center_x, center_y) = frame.center();
                let distance = (center_x - x).hypot(center_y - y);
                let acceptable = score >= 0.5 || frame.contains(x, y);
                let better = best.as_ref().is_none_or(|(best_score, best_distance, _)| {
                    score > *best_score || (score == *best_score && distance < *best_distance)
                });
                if acceptable && better {
                    best = Some((
                        score,
                        distance,
                        serde_json::json!({
                            "x": center_x, "y": center_y,
                            "frame": {"x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height},
                            "role": role, "title": current.name(), "matched": score >= 0.5,
                        }),
                    ));
                }
                seen.push(current);
                break;
            }
            match automation.parent(&current) {
                Some(parent) => current = parent,
                None => break,
            }
        }
    }
    Ok(best.map(|(_, _, element)| element))
}

#[cfg(windows)]
fn label_words(label: &str) -> Vec<String> {
    const SKIP: &[&str] = &[
        "click", "open", "press", "choose", "select", "tap", "the", "a", "an", "on", "to", "in",
        "go", "use", "pick", "this", "that", "here", "type", "into", "enter", "button", "menu",
        "field", "icon", "tab", "your", "of",
    ];
    label
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 1 && !SKIP.contains(word))
        .map(str::to_owned)
        .collect()
}

#[cfg(all(test, windows))]
mod tests;
