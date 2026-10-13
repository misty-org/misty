//! UI Automation: what a control on screen is, and acting on it the way an
//! assistive tool does, the Windows counterpart of the Accessibility API.
//!
//! Every call reaches into another app, which can be slow or hung, so each
//! has a short timeout. Misty's own windows are never a target.
use windows::{
    core::{Interface, BSTR},
    Win32::{
        Foundation::{POINT, RECT},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
        UI::Accessibility::*,
    },
};

/// How long one call into another app may take.
const TIMEOUT_MS: u32 = 250;

/// A UI Automation client for the current thread. COM stays initialized for
/// as long as it lives.
pub struct Automation {
    client: IUIAutomation,
    walker: IUIAutomationTreeWalker,
    initialized: bool,
}

impl Automation {
    pub fn new() -> Result<Self, String> {
        // SAFETY: balanced in Drop when it succeeded (S_OK or S_FALSE); a
        // thread already in another apartment keeps it.
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let unavailable = |_| "UI Automation is unavailable.".to_owned();
        // SAFETY: plain COM object creation; the interfaces own their references.
        let (client, walker) = unsafe {
            let client: IUIAutomation =
                CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                    .or_else(|_| CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER))
                    .map_err(unavailable)?;
            if let Ok(timed) = client.cast::<IUIAutomation2>() {
                let _ = timed.SetTransactionTimeout(TIMEOUT_MS);
                let _ = timed.SetConnectionTimeout(TIMEOUT_MS * 4);
            }
            let walker = client.ControlViewWalker().map_err(unavailable)?;
            (client, walker)
        };
        Ok(Self {
            client,
            walker,
            initialized,
        })
    }

    /// The control at a point in physical screen pixels, unless it is Misty's.
    pub fn element_at(&self, x: i32, y: i32) -> Option<Element> {
        // SAFETY: a plain query; the element owns its reference.
        let element = unsafe { self.client.ElementFromPoint(POINT { x, y }) }.ok()?;
        let element = Element(element);
        (!element.is_misty()).then_some(element)
    }

    /// The control that has keyboard focus, unless it is Misty's.
    pub fn focused(&self) -> Option<Element> {
        // SAFETY: a plain query.
        let element = Element(unsafe { self.client.GetFocusedElement() }.ok()?);
        (!element.is_misty()).then_some(element)
    }

    pub fn parent(&self, element: &Element) -> Option<Element> {
        // SAFETY: a plain query on a live element.
        unsafe { self.walker.GetParentElement(&element.0) }
            .ok()
            .map(Element)
    }
}

impl Drop for Automation {
    fn drop(&mut self) {
        if self.initialized {
            // SAFETY: matches the successful CoInitializeEx in `new`.
            unsafe { CoUninitialize() };
        }
    }
}

/// One control in another app.
pub struct Element(IUIAutomationElement);

/// A control's bounds in physical screen pixels.
#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

fn text(value: windows::core::Result<BSTR>) -> String {
    value.map(|text| text.to_string()).unwrap_or_default()
}

impl Element {
    fn is_misty(&self) -> bool {
        // SAFETY: a plain property read.
        unsafe { self.0.CurrentProcessId() }.is_ok_and(|pid| pid as u32 == std::process::id())
    }

    pub fn control_type(&self) -> i32 {
        // SAFETY: a plain property read.
        unsafe { self.0.CurrentControlType() }.map_or(0, |kind| kind.0)
    }

    /// The control type as a short role name, such as "Button".
    pub fn role(&self) -> &'static str {
        role_name(self.control_type())
    }

    pub fn name(&self) -> String {
        // SAFETY: a plain property read.
        text(unsafe { self.0.CurrentName() })
    }

    /// Name, help text, automation ID and value together, for matching words.
    pub fn description(&self) -> String {
        // SAFETY: plain property reads.
        let (help, id) = unsafe {
            (
                text(self.0.CurrentHelpText()),
                text(self.0.CurrentAutomationId()),
            )
        };
        [self.name(), help, id, self.value().unwrap_or_default()].join(" ")
    }

    pub fn bounds(&self) -> Option<Bounds> {
        // SAFETY: a plain property read.
        let RECT {
            left,
            top,
            right,
            bottom,
        } = unsafe { self.0.CurrentBoundingRectangle() }.ok()?;
        (right > left && bottom > top).then(|| Bounds {
            x: f64::from(left),
            y: f64::from(top),
            width: f64::from(right - left),
            height: f64::from(bottom - top),
        })
    }

    pub fn is_password(&self) -> bool {
        // SAFETY: a plain property read.
        unsafe { self.0.CurrentIsPassword() }.is_ok_and(|value| value.as_bool())
    }

    pub fn is_enabled(&self) -> bool {
        // SAFETY: a plain property read.
        unsafe { self.0.CurrentIsEnabled() }.is_ok_and(|value| value.as_bool())
    }

    /// The text in a field, never a password's.
    pub fn value(&self) -> Option<String> {
        if self.is_password() {
            return None;
        }
        // SAFETY: the pattern is queried by its own interface type.
        let pattern: IUIAutomationValuePattern =
            unsafe { self.0.GetCurrentPatternAs(UIA_ValuePatternId) }.ok()?;
        // SAFETY: a plain property read.
        Some(text(unsafe { pattern.CurrentValue() }))
    }

    /// Whether the control does something when pressed.
    pub fn pressable(&self) -> bool {
        [
            UIA_InvokePatternId,
            UIA_TogglePatternId,
            UIA_SelectionItemPatternId,
            UIA_ExpandCollapsePatternId,
        ]
        .into_iter()
        // SAFETY: plain pattern queries.
        .any(|pattern| {
            unsafe { self.0.GetCurrentPattern(pattern) }
                .is_ok_and(|found| found.as_raw() as usize != 0)
        })
    }

    /// Presses the control: invoke, toggle, select or expand, whichever it
    /// supports, without moving the person's pointer.
    pub fn press(&self) -> Result<(), String> {
        let failed = |_| "That control didn't respond.".to_owned();
        // SAFETY: each pattern is queried by its own interface type and used
        // only when present.
        unsafe {
            if let Ok(pattern) = self
                .0
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
            {
                return pattern.Invoke().map_err(failed);
            }
            if let Ok(pattern) = self
                .0
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            {
                return pattern.Toggle().map_err(failed);
            }
            if let Ok(pattern) = self
                .0
                .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(
                    UIA_SelectionItemPatternId,
                )
            {
                return pattern.Select().map_err(failed);
            }
            if let Ok(pattern) = self
                .0
                .GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(
                    UIA_ExpandCollapsePatternId,
                )
            {
                let state = pattern.CurrentExpandCollapseState().map_err(failed)?;
                return if state == ExpandCollapseState_Collapsed {
                    pattern.Expand().map_err(failed)
                } else {
                    pattern.Collapse().map_err(failed)
                };
            }
        }
        Err("That control can't be pressed.".into())
    }

    pub fn focus(&self) -> Result<(), String> {
        // SAFETY: a plain call on a live element.
        unsafe { self.0.SetFocus() }.map_err(|_| "That control can't take focus.".into())
    }

    /// Replaces the text in a field. Password fields are refused.
    pub fn set_value(&self, value: &str) -> Result<(), String> {
        if self.is_password() {
            return Err("Agents don't type into password fields.".into());
        }
        // SAFETY: the pattern is queried by its own interface type.
        let pattern: IUIAutomationValuePattern =
            unsafe { self.0.GetCurrentPatternAs(UIA_ValuePatternId) }
                .map_err(|_| "That field doesn't take text.".to_owned())?;
        // SAFETY: a plain call with an owned string.
        unsafe { pattern.SetValue(&BSTR::from(value)) }
            .map_err(|_| "That field refused the text.".into())
    }

    /// Scrolls the control by whole steps (positive is down or right).
    pub fn scroll(&self, horizontal: i32, vertical: i32) -> Result<(), String> {
        // SAFETY: the pattern is queried by its own interface type.
        let pattern: IUIAutomationScrollPattern =
            unsafe { self.0.GetCurrentPatternAs(UIA_ScrollPatternId) }
                .map_err(|_| "That area doesn't scroll.".to_owned())?;
        let amount = |steps: i32| match steps.signum() {
            1 => ScrollAmount_SmallIncrement,
            -1 => ScrollAmount_SmallDecrement,
            _ => ScrollAmount_NoAmount,
        };
        for _ in 0..horizontal
            .unsigned_abs()
            .max(vertical.unsigned_abs())
            .min(20)
        {
            // SAFETY: a plain call on a live pattern.
            unsafe { pattern.Scroll(amount(horizontal), amount(vertical)) }
                .map_err(|_| "That area didn't scroll.".to_owned())?;
        }
        Ok(())
    }

    pub fn supports_scrolling(&self) -> bool {
        // SAFETY: a plain pattern query.
        unsafe { self.0.GetCurrentPattern(UIA_ScrollPatternId) }
            .is_ok_and(|found| found.as_raw() as usize != 0)
    }

    pub fn same_as(&self, other: &Element) -> bool {
        // SAFETY: a plain comparison through the automation runtime IDs.
        unsafe {
            match (self.0.GetRuntimeId(), other.0.GetRuntimeId()) {
                (Ok(left), Ok(right)) => safe_array_equal(left, right),
                _ => false,
            }
        }
    }
}

/// Compares two runtime-ID arrays and frees them.
unsafe fn safe_array_equal(
    left: *mut windows::Win32::System::Com::SAFEARRAY,
    right: *mut windows::Win32::System::Com::SAFEARRAY,
) -> bool {
    use windows::Win32::System::Ole::{SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetUBound};
    let read = |array: *mut windows::Win32::System::Com::SAFEARRAY| -> Vec<i32> {
        if array.is_null() {
            return Vec::new();
        }
        let upper = SafeArrayGetUBound(array, 1).unwrap_or(-1);
        (0..=upper)
            .filter_map(|index| {
                let mut value = 0i32;
                SafeArrayGetElement(array, &index, std::ptr::addr_of_mut!(value).cast())
                    .ok()
                    .map(|_| value)
            })
            .collect()
    };
    let equal = {
        let (left_ids, right_ids) = (read(left), read(right));
        !left_ids.is_empty() && left_ids == right_ids
    };
    for array in [left, right] {
        if !array.is_null() {
            let _ = SafeArrayDestroy(array);
        }
    }
    equal
}

/// Short names for the control types a person points at or acts on.
const ROLES: [(UIA_CONTROLTYPE_ID, &str); 20] = [
    (UIA_ButtonControlTypeId, "Button"),
    (UIA_SplitButtonControlTypeId, "SplitButton"),
    (UIA_MenuItemControlTypeId, "MenuItem"),
    (UIA_MenuBarControlTypeId, "MenuBar"),
    (UIA_CheckBoxControlTypeId, "CheckBox"),
    (UIA_RadioButtonControlTypeId, "RadioButton"),
    (UIA_ComboBoxControlTypeId, "ComboBox"),
    (UIA_EditControlTypeId, "Edit"),
    (UIA_DocumentControlTypeId, "Document"),
    (UIA_HyperlinkControlTypeId, "Hyperlink"),
    (UIA_SliderControlTypeId, "Slider"),
    (UIA_SpinnerControlTypeId, "Spinner"),
    (UIA_TabItemControlTypeId, "TabItem"),
    (UIA_ListItemControlTypeId, "ListItem"),
    (UIA_TreeItemControlTypeId, "TreeItem"),
    (UIA_DataItemControlTypeId, "DataItem"),
    (UIA_ImageControlTypeId, "Image"),
    (UIA_TextControlTypeId, "Text"),
    (UIA_WindowControlTypeId, "Window"),
    (UIA_PaneControlTypeId, "Pane"),
];

fn role_name(kind: i32) -> &'static str {
    ROLES
        .iter()
        .find(|(id, _)| id.0 == kind)
        .map_or("Other", |(_, name)| name)
}

/// Roles a person points at; containers such as panes and windows are not.
pub fn is_target_role(role: &str) -> bool {
    !matches!(role, "Window" | "Pane" | "MenuBar" | "Other")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automation_reads_what_is_on_screen() {
        let automation = Automation::new().unwrap();
        // The taskbar or desktop is always somewhere; reading never acts.
        let found = automation
            .element_at(5, 5)
            .or_else(|| automation.element_at(400, 400));
        if let Some(element) = found {
            assert!(!element.role().is_empty());
            let _ = (element.bounds(), element.description(), element.pressable());
        }
    }

    #[test]
    fn container_roles_are_not_targets() {
        for role in ["Window", "Pane", "MenuBar", "Other"] {
            assert!(!is_target_role(role));
        }
        assert!(is_target_role("Button") && is_target_role("Edit"));
    }
}
