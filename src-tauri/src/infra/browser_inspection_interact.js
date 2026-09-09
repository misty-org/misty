function (target, action, expectedOrigin, expectedDocument) {
  try {
    const semanticSnapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (semanticSnapshot?.readSemantic && JSON.stringify(semanticSnapshot.readSemantic()) !== semanticSnapshot.semanticFingerprint)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The account or reviewed content changed. Inspect the page again before acting." };
    if (location.origin !== expectedOrigin) return { ok: false, error: "The browser origin changed. Inspect again." };
    const snapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (!snapshot || snapshot.document !== document || snapshot.origin !== location.origin || snapshot.consumed || (expectedDocument && snapshot.nonce !== expectedDocument))
      return { ok: false, error: "Inspect this document again before interacting." };
    const targets = window[Symbol.for("misty.browser.inspection")];
    const record = target ? targets?.get(target) : null;
    const element = record?.element;
    if (target && (!element?.isConnected || element.ownerDocument !== document ||
      record.readFingerprint(element) !== record.fingerprint))
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The inspected control changed. Inspect the page again before acting." };
    if (element && (element.disabled || element.readOnly || /^(password|hidden|file)$/i.test(element.getAttribute("type") || "")))
      return { ok: false, error: "This control requires user interaction." };
    // Consume the entire snapshot before an action, including a failed attempt.
    snapshot.consumed = true;
    targets?.clear();
    switch (action.kind) {
      case "fill": {
        if (typeof action.text !== "string" || action.text.length > 65536) throw new Error("Invalid text input.");
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) throw new Error("This input cannot be filled.");
          element.focus();
          setter.call(element, action.text);
        } else if (element?.isContentEditable) {
          element.focus();
          element.textContent = action.text;
        } else throw new Error("The inspected control is not editable.");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "select": {
        if (!(element instanceof HTMLSelectElement) || !Array.isArray(action.values) || !action.values.length || action.values.length > 100 || (!element.multiple && action.values.length !== 1)) throw new Error("Invalid selection.");
        if (action.values.some(value => typeof value !== "string" || value.length > 1000 || !Array.from(element.options).some(option => option.value === value && !option.disabled))) throw new Error("An option is unavailable.");
        for (const option of element.options) option.selected = action.values.includes(option.value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "scroll": {
        if (![action.x, action.y].every(value => Number.isInteger(value) && Math.abs(value) <= 4000)) throw new Error("Invalid scroll distance.");
        (element || window).scrollBy({ left: action.x, top: action.y, behavior: "instant" });
        break;
      }
      case "key": {
        if (!element || !["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(action.key)) throw new Error("Unsupported key.");
        element.focus();
        // Synthetic keys do not reproduce every browser default. The caller must
        // inspect the result rather than assuming a form submitted or focus moved.
        element.dispatchEvent(new KeyboardEvent("keydown", { key: action.key, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key: action.key, bubbles: true, cancelable: true }));
        break;
      }
      default: throw new Error("Unsupported browser interaction.");
    }
    return { ok: true, attempted: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
