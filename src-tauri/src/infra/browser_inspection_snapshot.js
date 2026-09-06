function (nonce, maxText, maxElements) {
  try {
    const targets = new Map();
    window[Symbol.for("misty.browser.inspection")] = targets;
    const label = (element) => (
      element.getAttribute("aria-label") || element.innerText || element.textContent ||
      element.getAttribute("title") || element.getAttribute("placeholder") ||
      (/^(button|submit|reset)$/i.test(element.getAttribute("type") || "") ? element.getAttribute("value") : "") || ""
    ).trim().slice(0, 300);
    const fingerprint = (element) => JSON.stringify([
      element.tagName.toLowerCase(), element.getAttribute("role") || "", label(element),
      element.getAttribute("href"), Boolean(element.disabled),
      typeof element.checked === "boolean" ? element.checked : null,
      element.closest('tr,[role="row"],li,[role="listitem"]')?.textContent?.slice(0, 2000) || "",
    ]);
    const rawText = document.body?.innerText ?? document.body?.textContent ?? "";
    const candidates = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]):not([type="password"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])'))
      .filter((element) => !/^(hidden|password)$/i.test(element.getAttribute("type") || ""))
      .slice(0, maxElements);
    const interactive = candidates.map((element, index) => {
      const target = `${nonce}:${index}`;
      targets.set(target, { element, fingerprint: fingerprint(element), readFingerprint: fingerprint });
      return { target, tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "", name: label(element) };
    });
    return { url: location.href, title: document.title || "", text: rawText.slice(0, maxText), truncated: rawText.length > maxText, interactive, error: "" };
  } catch (error) {
    return { url: location.href, title: document.title || "", text: "", truncated: false, interactive: [], error: String(error) };
  }
}
