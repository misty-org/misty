//! Choosing the display under control, entering control and capturing it.
use super::*;

/// The display under the person's pointer, or the one already controlled:
/// moving the pointer never retargets the agent's frame.
fn target_display() -> Result<(u32, Frame), String> {
    if let Some(display) = with(|control| control.display.filter(|_| control.controlling)) {
        return Ok(display);
    }
    let mut cursor = POINT { x: 0, y: 0 };
    // SAFETY: a plain query into a local.
    unsafe { GetCursorPos(&mut cursor) };
    let monitor = xcap::Monitor::from_point(cursor.x, cursor.y)
        .or_else(|_| {
            xcap::Monitor::all()
                .map_err(|_| xcap::XCapError::new("no display"))?
                .into_iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .ok_or(xcap::XCapError::new("no display"))
        })
        .map_err(|_| "No display is available to control.".to_owned())?;
    display_of(&monitor)
}

pub(super) fn display_of(monitor: &xcap::Monitor) -> Result<(u32, Frame), String> {
    let failed = |_| "The display is unavailable.".to_owned();
    Ok((
        monitor.id().map_err(failed)?,
        Frame {
            x: monitor.x().map_err(failed)?,
            y: monitor.y().map_err(failed)?,
            width: monitor.width().map_err(failed)? as i32,
            height: monitor.height().map_err(failed)? as i32,
        },
    ))
}

fn begin_control(display: (u32, Frame)) -> Result<(), String> {
    let app = with(|control| {
        if control.stopped || control.task.is_empty() {
            return Err("Desktop control stopped. Start or resume a task.".to_owned());
        }
        if control
            .lease_until
            .is_none_or(|until| Instant::now() >= until)
        {
            return Err("The desktop execution lease expired.".to_owned());
        }
        Ok((!control.controlling)
            .then(|| control.app.clone())
            .flatten())
    })?;
    let Some(app) = app else {
        return Ok(());
    };
    start_guard()?;
    CONTROLLING.store(true, Ordering::Release);
    let island = with(|control| {
        control.controlling = true;
        control.display = Some(display);
        control.island.clone()
    });
    overlays::show_island(&app, display.1)?;
    overlays::set_island(&app, island, false);
    overlays::show_mist(&app, display.1, false)?;
    Ok(())
}

/// Captures the controlled display for the agent, entering control first.
/// Called on a worker thread.
pub fn capture(task: &str) -> Result<Value, String> {
    confirm(task)?;
    let display = target_display()?;
    if let Err(failure) = begin_control(display) {
        stop_control(Some(&failure));
        return Err(failure);
    }
    // The frame shows the effect of the last action.
    if let Some(last) = with(|control| control.last_action) {
        let settle = Duration::from_millis(150).saturating_sub(last.elapsed());
        thread::sleep(settle);
    }
    let monitor = xcap::Monitor::all()
        .ok()
        .and_then(|monitors| {
            monitors
                .into_iter()
                .find(|monitor| monitor.id().is_ok_and(|id| id == display.0))
        })
        .ok_or("The display was disconnected.")?;
    let image = monitor
        .capture_image()
        .map_err(|_| "The display could not be captured.".to_owned())?;
    let valid = with(|control| {
        !control.stopped
            && control.controlling
            && control.task == task
            && control
                .lease_until
                .is_some_and(|until| Instant::now() < until)
    });
    if !valid {
        return Err("Desktop control stopped during capture.".into());
    }
    let image = image::DynamicImage::ImageRgba8(image);
    let image = if image.width().max(image.height()) > MAX_EDGE {
        image.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&image.to_rgb8())
        .map_err(|_| "The display frame could not be encoded.".to_owned())?;
    let frame = display.1;
    Ok(json!({
        "image": {
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg.into_inner())),
            "width": image.width(),
            "height": image.height(),
        },
        "desktop": true,
        "taskID": task,
        "displayID": display.0,
        "frame": [frame.x, frame.y, frame.width, frame.height],
    }))
}
