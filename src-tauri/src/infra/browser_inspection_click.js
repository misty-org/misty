function (target) {
  try {
    const record = window[Symbol.for("misty.browser.inspection")]?.get(target);
    const element = record?.element;
    if (!element?.isConnected || element.ownerDocument !== document ||
        record.readFingerprint(element) !== record.fingerprint) {
      return { ok: false, error: "The inspected control changed. Inspect the page again before acting." };
    }
    element.click();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
