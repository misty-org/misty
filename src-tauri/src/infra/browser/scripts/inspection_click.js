function (target) {
  try {
    const semanticSnapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (semanticSnapshot?.readSemantic && JSON.stringify(semanticSnapshot.readSemantic()) !== semanticSnapshot.semanticFingerprint)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The account or reviewed content changed. Inspect the page again before acting." };
    const record = window[Symbol.for("misty.browser.inspection")]?.get(target);
    const element = record?.element;
    if (!element?.isConnected || element.ownerDocument !== record.document || !record.isCurrent() ||
        record.readFingerprint(element) !== record.fingerprint) {
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The inspected control changed. Inspect the page again before acting." };
    }
    const snapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (!snapshot || snapshot.document !== document || snapshot.origin !== location.origin || snapshot.consumed)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "Inspect this document again before clicking." };
    snapshot.consumed = true;
    window[Symbol.for("misty.browser.inspection")]?.clear();
    window[Symbol.for("misty.browser.agent.cursor")]?.move(element);
    const bounds = element.getBoundingClientRect();
    const mouse = { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
      bubbles: true, cancelable: true, composed: true, button: 0 };
    // Some controls (including Drive menus) activate on mouse-down instead of
    // click. Dispatch one complete sequence, never a second fallback click.
    const compatibilityMouse = element.dispatchEvent(new PointerEvent("pointerdown", { ...mouse, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    if (compatibilityMouse) element.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
    if (element.isConnected) {
      element.dispatchEvent(new PointerEvent("pointerup", { ...mouse, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      if (compatibilityMouse) element.dispatchEvent(new MouseEvent("mouseup", { ...mouse, buttons: 0 }));
      if (element.isConnected) element.dispatchEvent(new MouseEvent("click", { ...mouse, buttons: 0, detail: 1 }));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
