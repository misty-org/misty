//! What Misty does in the app in front: press or focus the control under its
//! cursor, scroll, fill a field, or type the named keys an action asks for.
use super::*;

/// Performs one validated action on the controlled display. Called on a
/// worker thread, after the task, grant and one-use frame were checked.
pub fn action(input: &Value) -> Result<Value, String> {
    let (app, display) = with(|control| {
        let live = !control.stopped
            && control.controlling
            && control
                .lease_until
                .is_some_and(|until| Instant::now() < until);
        if !live {
            return Err("Desktop control stopped. You have control.".to_owned());
        }
        if input["taskID"].as_str() != Some(control.task.as_str()) {
            return Err("Desktop task changed.".to_owned());
        }
        Ok((control.app.clone(), control.display))
    })?;
    let (app, (id, frame)) = (
        app.ok_or("Desktop control stopped.")?,
        display.ok_or("Desktop control stopped.")?,
    );
    let expected = input["frame"]
        .as_array()
        .map(|values| values.iter().filter_map(Value::as_i64).collect::<Vec<_>>());
    let current = xcap::Monitor::all()
        .ok()
        .and_then(|monitors| {
            monitors
                .into_iter()
                .find(|monitor| monitor.id().is_ok_and(|found| found == id))
        })
        .and_then(|monitor| display_of(&monitor).ok());
    let same = |frame: Frame| {
        expected.as_deref()
            == Some(
                &[
                    i64::from(frame.x),
                    i64::from(frame.y),
                    i64::from(frame.width),
                    i64::from(frame.height),
                ][..],
            )
    };
    if input["displayID"].as_u64() != Some(u64::from(id))
        || current.is_none_or(|(_, now)| now != frame || !same(now))
    {
        return Err("browser_snapshot_stale: display geometry changed; inspect again".into());
    }
    let action = &input["action"];
    let (x, y) = (
        action["x"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0),
        action["y"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0),
    );
    let point = (
        f64::from(frame.x) + x * f64::from(frame.width),
        f64::from(frame.y) + y * f64::from(frame.height),
    );
    let kind = action["kind"].as_str().unwrap_or("");
    if matches!(kind, "point" | "scroll") {
        overlays::point(&app, point.0, point.1);
    }
    let automation = Automation::new()?;
    let (effect, target) = match kind {
        "point" => point_at(&automation, point)?,
        "scroll" => scroll_at(
            &automation,
            point,
            action["deltaX"].as_i64().unwrap_or(0),
            action["deltaY"].as_i64().unwrap_or(0),
        )?,
        "type" => type_text(&automation, action["text"].as_str().unwrap_or(""))?,
        "key" => press_key(action["key"].as_str().unwrap_or(""))?,
        _ => return Err("Unsupported desktop action.".into()),
    };
    with(|control| control.last_action = Some(Instant::now()));
    let mut output =
        json!({ "attempted": true, "verified": false, "input": "automation", "effect": effect });
    if let Some((role, title)) = target {
        output["target"] = json!({ "role": role, "title": title });
    }
    if matches!(kind, "point" | "scroll") {
        output["cursor"] = json!({ "x": x, "y": y });
    }
    Ok(output)
}

type Effect = (&'static str, Option<(String, String)>);

pub(super) fn is_misty_at(point: (f64, f64)) -> bool {
    // SAFETY: plain queries; a point over nothing yields a null window.
    unsafe {
        let window = WindowFromPoint(POINT {
            x: point.0.round() as i32,
            y: point.1.round() as i32,
        });
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, &mut pid);
        pid == std::process::id()
    }
}

pub(super) fn editable(element: &Element) -> bool {
    matches!(element.role(), "Edit" | "ComboBox" | "Document")
}

/// Presses or focuses the control under a point, without the real pointer.
pub(super) fn point_at(automation: &Automation, point: (f64, f64)) -> Result<Effect, String> {
    if is_misty_at(point) {
        return Err("That is Misty's own control. Never operate the control strip or Stop.".into());
    }
    let mut current = automation
        .element_at(point.0.round() as i32, point.1.round() as i32)
        .ok_or("Nothing Misty can use is at that point. Choose a visible control.")?;
    for _ in 0..6 {
        if current.role() == "Window" {
            break;
        }
        let described = || Some((current.role().to_owned(), current.name()));
        if editable(&current) && current.is_enabled() && current.focus().is_ok() {
            return Ok(("focused", described()));
        }
        if current.pressable() {
            current.press()?;
            return Ok(("pressed", described()));
        }
        match automation.parent(&current) {
            Some(parent) => current = parent,
            None => break,
        }
    }
    Err("That spot has no button or field Misty can use without the real pointer. Try a nearby labeled control.".into())
}

/// Scroll steps for a pixel delta: about one per wheel notch (120 pixels),
/// at least one, at most 20, in the delta's direction.
pub(super) fn steps(delta: i64) -> i32 {
    if delta == 0 {
        return 0;
    }
    let notches = (delta.unsigned_abs() as f64 / 120.0)
        .round()
        .clamp(1.0, 20.0) as i32;
    notches * delta.signum() as i32
}

pub(super) fn scroll_at(
    automation: &Automation,
    point: (f64, f64),
    delta_x: i64,
    delta_y: i64,
) -> Result<Effect, String> {
    if is_misty_at(point) {
        return Err("That is Misty's own control.".into());
    }
    let mut current = automation
        .element_at(point.0.round() as i32, point.1.round() as i32)
        .ok_or("Nothing to scroll at that point.")?;
    let (horizontal, vertical) = (steps(delta_x), steps(delta_y));
    for _ in 0..8 {
        if current.supports_scrolling() {
            current.scroll(horizontal, vertical)?;
            return Ok((
                "scrolled",
                Some((current.role().to_owned(), current.name())),
            ));
        }
        match automation.parent(&current) {
            Some(parent) => current = parent,
            None => break,
        }
    }
    Err("Nothing at that point scrolls.".into())
}

/// Adds text to the field Misty focused. Password fields are refused.
pub(super) fn type_text(automation: &Automation, text: &str) -> Result<Effect, String> {
    if text.chars().count() > 16000 {
        return Err("Invalid text.".into());
    }
    let field = automation
        .focused()
        .filter(editable)
        .ok_or("Click a text field before typing.")?;
    if field.is_password() {
        return Err("Agents don't type into password fields.".into());
    }
    let current = field
        .value()
        .ok_or("That field does not accept text from Misty.")?;
    field.set_value(&format!("{current}{text}"))?;
    Ok(("appended", Some((field.role().to_owned(), field.name()))))
}

/// Types one named key into the app in front, which must not be Misty.
pub(super) fn press_key(key: &str) -> Result<Effect, String> {
    let (code, control): (VIRTUAL_KEY, bool) = match key {
        "Enter" => (VK_RETURN, false),
        "Escape" => (VK_ESCAPE, false),
        "Tab" => (VK_TAB, false),
        "Backspace" => (VK_BACK, false),
        "ArrowLeft" => (VK_LEFT, false),
        "ArrowRight" => (VK_RIGHT, false),
        "ArrowUp" => (VK_UP, false),
        "ArrowDown" => (VK_DOWN, false),
        "SelectAll" => (u16::from(b'A'), true),
        "Undo" => (u16::from(b'Z'), true),
        "AddressBar" => (u16::from(b'L'), true),
        "NewTab" => (u16::from(b'T'), true),
        "Find" => (u16::from(b'F'), true),
        _ => return Err("Unsupported desktop key.".into()),
    };
    // SAFETY: plain queries.
    let in_front = unsafe {
        let window = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, &mut pid);
        (!window.is_null()).then_some(pid)
    };
    match in_front {
        None => return Err("Click into an app before pressing keys.".into()),
        Some(pid) if pid == std::process::id() => {
            return Err("Misty is in front. Click into the app to use first.".into())
        }
        Some(_) => {}
    }
    let key = |code: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: AGENT_TAG,
            },
        },
    };
    let mut inputs = Vec::with_capacity(4);
    if control {
        inputs.push(key(VK_CONTROL, false));
    }
    inputs.push(key(code, false));
    inputs.push(key(code, true));
    if control {
        inputs.push(key(VK_CONTROL, true));
    }
    // SAFETY: a slice of fully initialized inputs.
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent as usize != inputs.len() {
        return Err(
            "Windows refused the key. An app running as administrator can't be controlled.".into(),
        );
    }
    Ok(("key", None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_deltas_become_whole_steps() {
        assert_eq!(steps(0), 0);
        assert_eq!(steps(30), 1);
        assert_eq!(steps(-30), -1);
        assert_eq!(steps(360), 3);
        assert_eq!(steps(-2000), -17);
        assert_eq!(steps(100_000), 20);
    }

    #[test]
    fn actions_need_a_live_control_session() {
        let input = json!({ "taskID": "nobody", "action": { "kind": "key", "key": "Enter" } });
        assert!(action(&input).is_err());
    }
}
