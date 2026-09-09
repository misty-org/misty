function (target) {
  try {
    const semanticSnapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (semanticSnapshot?.readSemantic && JSON.stringify(semanticSnapshot.readSemantic()) !== semanticSnapshot.semanticFingerprint)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The account or reviewed content changed. Inspect the page again before acting." };
    const record = window[Symbol.for("misty.browser.inspection")]?.get(target);
    const element = record?.element;
    if (!element?.isConnected || element.ownerDocument !== document ||
        record.readFingerprint(element) !== record.fingerprint) {
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The inspected control changed. Inspect the page again before acting." };
    }
    const snapshot = window[Symbol.for("misty.browser.inspection.document")];
    if (!snapshot || snapshot.document !== document || snapshot.origin !== location.origin || snapshot.consumed)
      return { ok: false, errorCode: "browser_snapshot_stale", error: "Inspect this document again before clicking." };
    snapshot.consumed = true;
    window[Symbol.for("misty.browser.inspection")]?.clear();
    element.click();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
