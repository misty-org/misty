function (target, text) {
  try {
    const semanticSnapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (semanticSnapshot?.readSemantic && JSON.stringify(semanticSnapshot.readSemantic()) !== semanticSnapshot.semanticFingerprint)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The account or reviewed content changed. Inspect the page again before acting." };
    const record = window[Symbol.for("misty.browser.inspection")]?.get(target);
    const element = record?.element;
    if (!element?.isConnected || element.ownerDocument !== document ||
        record.readFingerprint(element) !== record.fingerprint)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The inspected control changed. Inspect the page again before acting." };
    if (element.disabled || element.readOnly || element.type === "password")
      return { ok: false, error: "This control does not accept draft text." };
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      if (element instanceof HTMLInputElement && !["text", "search", "email", "url", "tel"].includes(element.type))
        return { ok: false, error: "Select a text field." };
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, text);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (element.value !== text) return { ok: false, error: "The website did not retain the draft." };
    } else if (element.isContentEditable) {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand("insertText", false, text) || element.innerText.replace(/\r\n/g, "\n") !== text.replace(/\r\n/g, "\n"))
        return { ok: false, error: "The website did not retain the draft." };
    } else return { ok: false, error: "Select an editable text control." };
    return { ok: true, prepared: true };
  } catch (error) { return { ok: false, error: String(error) }; }
}
