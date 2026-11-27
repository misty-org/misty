use serde_json::{json, Value};

use crate::{rejected, PageHost};

const SIDE: std::ops::RangeInclusive<f64> = 200.0..=4000.0;

pub struct Fit {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

pub fn fit(home: [f64; 4], size: (f64, f64)) -> Fit {
    let [x, y, room_width, room_height] = home;
    let fits = (room_width / size.0).min(room_height / size.1).min(1.0);
    let (width, height) = (size.0 * fits, size.1 * fits);
    let scale = fits;
    Fit {
        x: x + (room_width - width) / 2.0,
        y: y + (room_height - height) / 2.0,
        width,
        height,
        scale,
    }
}

pub fn snap(fit: &Fit, size: (f64, f64)) -> (f64, f64, f64) {
    if fit.scale >= 1.0 {
        return (size.0, size.1, 1.0);
    }
    let around = |value: f64| [value.floor(), value.round(), value.ceil(), value.floor() - 1.0];
    let mut best = (fit.width.floor().max(1.0), fit.height.floor().max(1.0), fit.scale);
    for width in around(fit.width) {
        for height in around(fit.height) {
            if width < 1.0 || height < 1.0 {
                continue;
            }
            let low = (width / (size.0 + 1.0)).max(height / (size.1 + 1.0));
            let high = (width / size.0).min(height / size.1);
            if low < high {
                let zoom = high - (high - low) * 0.25;
                return (width, height, zoom);
            }
            best = (width, height, high.min(1.0));
        }
    }
    best
}

pub async fn emulate(host: &impl PageHost, input: &Value) -> Result<Value, String> {
    let sized = !input["width"].is_null() || !input["height"].is_null();
    let mut request = json!({});
    for field in ["colorScheme", "media", "reset"] {
        if !input[field].is_null() {
            request[field] = input[field].clone();
        }
    }
    if !sized && request.as_object().is_some_and(|fields| fields.is_empty()) {
        return Ok(rejected(
            "browser_emulate_invalid",
            "Give width and height, colorScheme, media or reset.",
        ));
    }
    if sized {
        let seen = host.call(None, "viewInfo", json!({}), false).await?;
        let width = input["width"].as_f64().or(seen["width"].as_f64()).unwrap_or(0.0);
        let height = input["height"].as_f64().or(seen["height"].as_f64()).unwrap_or(0.0);
        if !SIDE.contains(&width) || !SIDE.contains(&height) {
            return Ok(rejected(
                "browser_emulate_invalid",
                "width and height are between 200 and 4000 CSS pixels.",
            ));
        }
        if let Err(error) = host.resize(Some((width, height))).await {
            return Ok(rejected("browser_emulate_invalid", error));
        }
    } else if input["reset"] == true {
        let _ = host.resize(None).await;
    }
    let set = if request.as_object().is_some_and(|fields| !fields.is_empty()) {
        match host.emulate(request).await {
            Ok(set) => set,
            Err(error) => return Ok(rejected("browser_emulate_invalid", error)),
        }
    } else {
        Value::Null
    };
    host.sleep(100).await;
    let seen = host.call(None, "viewInfo", json!({}), false).await.unwrap_or(Value::Null);
    let mut answer = json!({"ok": true});
    for field in ["width", "height", "colorScheme", "media"] {
        answer[field] = if seen[field].is_null() { set[field].clone() } else { seen[field].clone() };
    }
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn a_size_fits_its_room_and_stays_centered() {
        let phone = fit([0.0, 38.0, 1280.0, 762.0], (390.0, 844.0));
        assert!((phone.scale - 762.0 / 844.0).abs() < 1e-9);
        assert!((phone.height - 762.0).abs() < 1e-9 && (phone.y - 38.0).abs() < 1e-9);
        assert!((phone.x - (1280.0 - phone.width) / 2.0).abs() < 1e-9);
        for room in [[0.0, 0.0, 1280.0, 800.0], [0.0, 38.0, 1180.0, 731.0], [0.0, 0.0, 600.0, 500.0]] {
            for size in [(390.0, 844.0), (1920.0, 1080.0), (768.0, 1024.0), (1366.0, 768.0)] {
                let (width, height, zoom) = super::snap(&fit(room, size), size);
                assert_eq!((width.fract(), height.fract()), (0.0, 0.0));
                assert_eq!(((width / zoom).floor(), (height / zoom).floor()), size, "{room:?} {size:?}");
            }
        }
        let small = fit([10.0, 0.0, 1280.0, 800.0], (400.0, 300.0));
        assert_eq!((small.scale, small.width, small.height), (1.0, 400.0, 300.0));
        assert_eq!((small.x, small.y), (450.0, 250.0));
    }
}
