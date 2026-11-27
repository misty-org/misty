use crate::host::PageHost;
use serde_json::{json, Value};

const DEVICE_LIMIT: f64 = 4096.0;

pub async fn picture<H: PageHost>(host: &H, input: &Value) -> Result<Value, String> {
    let mut args = json!({"fullPage": input["fullPage"] == true});
    if let Some(reference) = input["ref"].as_str() {
        if input["fullPage"] == true {
            return Err("A picture is of one element or of the full page, not both.".into());
        }
        args["ref"] = json!(reference);
        args["documentId"] = input["documentId"].clone();
    }
    let region = host.call(None, "region", args, false).await?;
    if region["ok"] != true {
        return Ok(region);
    }
    let number = |key: &str| region[key].as_f64().unwrap_or(0.0);
    let width = number("width");
    let height = number("height");
    let device = input["scale"] == "device";
    let image_width = if device {
        (width * input["deviceScale"].as_f64().unwrap_or(2.0)).min(DEVICE_LIMIT)
    } else {
        width
    };
    let lossless = input["type"] != "jpeg";
    let mut image = if input["fullPage"] == true {
        full_page(host, &region, image_width / width, lossless).await?
    } else {
        host.capture(
            [number("x"), number("y"), width, height],
            image_width,
            lossless,
        )
        .await?
    };
    if let Some(object) = image.as_object_mut() {
        object.insert(
            "region".into(),
            json!({"x": number("x"), "y": number("y"), "width": width, "height": height}),
        );
        object.insert("view".into(), region["view"].clone());
        object.insert("page".into(), region["page"].clone());
        object.insert("scale".into(), json!(if device { "device" } else { "css" }));
    }
    Ok(image)
}

const PAGE_LIMIT: f64 = 16_000.0;

async fn full_page<H: PageHost>(
    host: &H,
    region: &Value,
    scale: f64,
    lossless: bool,
) -> Result<Value, String> {
    let view_width = region["view"]["width"].as_f64().unwrap_or(0.0);
    let view_height = region["view"]["height"].as_f64().unwrap_or(0.0);
    let page_height = region["page"]["height"]
        .as_f64()
        .unwrap_or(view_height)
        .min(PAGE_LIMIT);
    if view_width < 1.0 || view_height < 1.0 {
        return Err("The page has no view to picture.".into());
    }
    let back_x = region["scrolled"]["x"].as_f64().unwrap_or(0.0);
    let back_y = region["scrolled"]["y"].as_f64().unwrap_or(0.0);
    let mut tiles = Vec::new();
    let mut top = 0.0;
    loop {
        let at = host
            .call(None, "scrollToY", json!({"x": 0, "y": top}), false)
            .await?;
        let landed = at["y"].as_f64().unwrap_or(top);
        host.sleep(120).await;
        let tile = host
            .capture(
                [0.0, 0.0, view_width, view_height],
                view_width * scale,
                true,
            )
            .await?;
        tiles.push(json!({"dataUrl": tile["dataUrl"], "y": landed * scale}));
        if landed + view_height >= page_height || landed < top {
            break;
        }
        top = landed + view_height;
    }
    let _ = host
        .call(None, "scrollToY", json!({"x": back_x, "y": back_y}), false)
        .await;
    let composed = host
        .call(
            None,
            "compose",
            json!({"tiles": tiles, "width": view_width * scale, "height": page_height * scale,
                "type": if lossless { "png" } else { "jpeg" }}),
            false,
        )
        .await?;
    Ok(
        json!({"dataUrl": composed["dataUrl"], "width": composed["width"], "height": composed["height"]}),
    )
}
