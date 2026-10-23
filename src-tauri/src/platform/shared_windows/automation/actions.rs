//! Acting on a control the way an assistive tool does: press, focus, fill
//! and scroll, without the person's pointer or keyboard.
use windows::{
    core::{Interface, BSTR},
    Win32::UI::Accessibility::*,
};

use super::Element;

impl Element {
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
}
