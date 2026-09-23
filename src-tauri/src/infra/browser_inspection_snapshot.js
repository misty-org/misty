function (nonce, maxText, maxElements, readSemantic) {
  try {
    const semantic = readSemantic ? readSemantic() : null;
    const semanticFingerprint = JSON.stringify(semantic);
    const targets = new Map();
    window[Symbol.for("misty.browser.inspection")] = targets;
    window[Symbol.for("misty.browser.inspection.document")] = { document, nonce, origin: location.origin, consumed: false, readSemantic, semanticFingerprint };
    const label = (element) => [
      element.getAttribute("aria-label"),
      (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => element.ownerDocument.getElementById(id)?.textContent || "").join(" "),
      element.innerText, element.textContent, element.getAttribute("alt"),
      Array.from(element.querySelectorAll("img[alt]")).map(image => image.getAttribute("alt")).filter(Boolean).join(" "),
      element.getAttribute("title"), element.getAttribute("placeholder"),
      /^(button|submit|reset)$/i.test(element.getAttribute("type") || "") ? element.getAttribute("value") : "",
      element.getAttribute("type") === "file" ? `File upload (${element.getAttribute("accept") || "any file"})` : "",
    ].map(value => (value || "").trim()).find(Boolean)?.slice(0, 300) || "";
    const fingerprint = (element) => JSON.stringify([
      element.tagName.toLowerCase(), element.getAttribute("role") || "", label(element),
      element.getAttribute("href"), element.getAttribute("type"), element.getAttribute("accept"), Boolean(element.multiple), Boolean(element.disabled),
      typeof element.checked === "boolean" ? element.checked : null,
      availableControl(element),
      element.closest('tr,[role="row"],li,[role="listitem"]')?.textContent?.slice(0, 2000) || "",
    ]);
    const scrollable = element => {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return (/^(auto|scroll|overlay)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) ||
        (/^(auto|scroll|overlay)$/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1);
    };
    const texts = [];
    const parent = element => element.parentElement || element.ownerDocument.defaultView?.frameElement;
    const availableControl = (element) => {
      if (/^(hidden|password)$/i.test(element.getAttribute("type") || "")) return false;
      // Websites intentionally hide file inputs behind an upload button. Keep
      // these addressable by the dedicated upload action, not ordinary fills.
      if (element.tagName === "INPUT" && element.type === "file") return true;
      for (let node = element; node; node = parent(node)) {
        if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
      }
      return true;
    };
    // Composite menus use roving tabindex: only the focused item has tabindex=0.
    // Their remaining visible actions are still independently addressable.
    const selector = 'a[href],button,input:not([type="hidden"]):not([type="password"]),select,textarea,[contenteditable="true"],[role="textbox"],[role="button"],[role="link"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[tabindex]:not([tabindex="-1"])';
    const candidates = [];
    let documents = 0, frameLimitReached = false;
    const collect = (owner, isCurrent, depth) => {
      if (documents >= 32 || depth > 8) { frameLimitReached = true; return; }
      documents++;
      texts.push(owner.body?.innerText ?? owner.body?.textContent ?? "");
      let scanned = 0;
      for (const element of owner.querySelectorAll(`${selector},div,section,main`)) {
        if (++scanned > 10000) { frameLimitReached = true; break; }
        if ((element.matches(selector) || scrollable(element)) && availableControl(element)) candidates.push({ element, owner, isCurrent });
        if (candidates.length > maxElements) return;
      }
      for (const frame of owner.querySelectorAll("iframe,frame")) {
        try {
          // Only documents the normal same-origin DOM can access are eligible.
          // Keep the exact frame/document chain pinned across review and action.
          const child = frame.contentDocument;
          if (!child?.defaultView || !availableControl(frame)) continue;
          collect(child, () => {
            try { return isCurrent() && frame.isConnected && frame.contentDocument === child; }
            catch { return false; }
          }, depth + 1);
          if (candidates.length > maxElements) return;
        } catch { /* Cross-origin and sandboxed frames remain inaccessible. */ }
      }
    };
    collect(document, () => true, 0);
    const rawText = texts.join("\n");
    const interactive = candidates.slice(0, maxElements).map(({ element, owner, isCurrent }, index) => {
      const target = `${nonce}:${index}`;
      targets.set(target, { element, document: owner, isCurrent, fingerprint: fingerprint(element), readFingerprint: fingerprint });
      return { target, tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "", name: scrollable(element) ? `Scrollable area${label(element) ? ": " + label(element) : ""}` : label(element) };
    });
    return { url: location.href, title: document.title || "", text: rawText.slice(0, maxText), truncated: frameLimitReached || rawText.length > maxText || candidates.length > maxElements, interactive, semantic, error: "" };
  } catch (error) {
    return { url: location.href, title: document.title || "", text: "", truncated: false, interactive: [], error: String(error) };
  }
}
