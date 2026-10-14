// Misty agent page runtime, part 3 of 4: actionability checks and the script
// side of actions. Clicks and keys go through native input on macOS, so pages
// receive trusted events; the script paths here are the fallback elsewhere.
((P) => {
  const fail = (error, extra = {}) => ({ ok: false, attempted: false, error, ...extra });

  const deepHit = (doc, x, y) => {
    let hit = doc.elementFromPoint(x, y);
    for (let depth = 0; hit?.shadowRoot && depth < 16; depth++) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };
  const composedContains = (el, node) => {
    for (let current = node; current; current = current.parentNode || current.host) if (current === el) return true;
    return false;
  };
  const receives = (el, hit) => !!hit && (composedContains(el, hit) || composedContains(hit, el) ||
    hit.closest?.("label")?.control === el);

  const textField = (el) => {
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "number", "password", ""].includes(type);
  };
  P.editable = (el) => !!el && (el.isContentEditable || (textField(el) && !el.readOnly && !el.disabled));

  /** Scrolls el into view and finds a point on it that receives a click. */
  P.prepare = (args) => {
    const resolved = P.resolve(args.documentId, args.ref);
    if (!resolved.ok) return resolved;
    const el = resolved.el;
    if (!el) {
      // A key with no ref goes to whatever has focus; Enter there may submit.
      const active = document.activeElement;
      const enter = args.action === "key" && args.key === "Enter";
      const consequence = enter ? P.consequence(active, "key") : "";
      const consequenceKind = enter ? P.consequenceKind(active, "key") : "";
      return { ok: true, point: null, viewport: { width: innerWidth, height: innerHeight }, editable: P.editable(active), consequence, consequenceKind, describe: P.describe(active) };
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return fail(`${P.describe(el)} is disabled.`, { errorCode: "browser_target_disabled" });
    const view = el.ownerDocument.defaultView;
    let rect = el.getBoundingClientRect();
    let scrolled = false;
    if (rect.top < 0 || rect.left < 0 || rect.bottom > view.innerHeight || rect.right > view.innerWidth) {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      rect = el.getBoundingClientRect();
      scrolled = true;
    }
    const judged = ["click", "check", "uncheck"].includes(args.action) || (args.action === "key" && args.key === "Enter");
    const consequence = judged ? P.consequence(el, args.action) : "";
    const consequenceKind = judged ? P.consequenceKind(el, args.action) : "";
    if (!["click", "check", "uncheck", "hover"].includes(args.action)) {
      return { ok: true, point: null, viewport: { width: innerWidth, height: innerHeight }, editable: P.editable(el), consequence, consequenceKind, describe: P.describe(el), scrolled, locator: P.locatorOf(el) };
    }
    if (rect.width < 1 || rect.height < 1) {
      // Custom checkboxes often hide the input and show its label instead.
      const label = el.labels?.[0];
      if (label) return P.prepare({ ...args, ref: P.register(label), consequenceOf: el });
      return fail(`${P.describe(el)} has no visible area to click.`, { errorCode: "browser_target_hidden" });
    }
    const inset = (low, size) => low + Math.min(Math.max(2, size / 4), 8);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [inset(rect.left, rect.width), rect.top + rect.height / 2],
      [rect.right - Math.min(Math.max(2, rect.width / 4), 8), rect.top + rect.height / 2],
      [rect.left + rect.width / 2, inset(rect.top, rect.height)],
      [rect.left + rect.width / 2, rect.bottom - Math.min(Math.max(2, rect.height / 4), 8)],
    ];
    let blocker = null;
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) continue;
      const hit = deepHit(el.ownerDocument, x, y);
      if (!receives(el, hit)) { blocker ??= hit; continue; }
      // Translate through every frame to the top viewport.
      let topX = x, topY = y;
      const chain = P.frameChain(el);
      for (let index = chain.length - 1; index >= 0; index--) {
        const frame = chain[index][0];
        const frameRect = frame.getBoundingClientRect();
        topX += frameRect.left + frame.clientLeft;
        topY += frameRect.top + frame.clientTop;
      }
      if (chain.length && !receives(chain[0][0], deepHit(document, topX, topY))) { blocker ??= deepHit(document, topX, topY); continue; }
      return {
        ok: true, point: { x: topX / innerWidth, y: topY / innerHeight }, viewport: { width: innerWidth, height: innerHeight },
        editable: P.editable(el), consequence: args.consequenceOf ? P.consequence(args.consequenceOf, args.action) : consequence,
        consequenceKind: args.consequenceOf ? P.consequenceKind(args.consequenceOf, args.action) : consequenceKind,
        describe: P.describe(args.consequenceOf || el), scrolled, locator: P.locatorOf(args.consequenceOf || el),
      };
    }
    return fail(`${P.describe(el)} is covered by ${P.describe(blocker) || "another element"}. Close or scroll past it first.`, { errorCode: "browser_target_covered" });
  };

  const unlocked = (view, action) => {
    // Off macOS the page-world input guard blocks trusted editing events while
    // the agent holds the page; an editing transaction is the agent's own.
    const locked = view.__MISTY_AGENT_INPUT_LOCKED__;
    try { view.__MISTY_AGENT_INPUT_LOCKED__ = false; return action(); }
    finally { view.__MISTY_AGENT_INPUT_LOCKED__ = locked; }
  };

  // detail is the click count a browser reports; button 2 is the right button.
  const mouse = (el, point, types, detail = 1, button = 0) => {
    const view = el.ownerDocument.defaultView;
    const rect = el.getBoundingClientRect();
    const init = { clientX: point?.x ?? rect.left + rect.width / 2, clientY: point?.y ?? rect.top + rect.height / 2,
      bubbles: true, cancelable: true, composed: true, button };
    const pressed = button === 2 ? 2 : 1;
    let proceed = true;
    for (const type of types) {
      if (!el.isConnected) break;
      if (type.startsWith("pointer")) {
        const Pointer = view.PointerEvent || view.MouseEvent;
        const result = el.dispatchEvent(new Pointer(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: type === "pointerdown" ? pressed : 0 }));
        if (type === "pointerdown") proceed = result;
      } else if (proceed || !/^mouse(down|up)$/.test(type)) {
        const counted = /^(mousedown|mouseup|click|dblclick|contextmenu)$/.test(type);
        el.dispatchEvent(new view.MouseEvent(type, { ...init, buttons: type === "mousedown" ? pressed : 0, detail: counted ? detail : 0 }));
      }
    }
  };

  const fill = (el, text) => {
    const view = el.ownerDocument.defaultView;
    const doc = el.ownerDocument;
    if (P.secret(el)) return fail(`This is a ${P.secret(el)} field. Ask the person to enter it with browser_request_user_action.`, { errorCode: "browser_secret_field" });
    if (el.readOnly || el.disabled) return fail(`${P.describe(el)} is read-only.`);
    if (el.tagName === "SELECT") return select(el, [text]);
    let target = el;
    if (!P.editable(el) && el.tagName !== "INPUT") {
      // ARIA comboboxes and editors wrap the real field.
      target = el.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true]') || el;
    }
    if (target.tagName === "INPUT" && !textField(target)) {
      // Dates, colors and ranges take a value, not typing.
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
      if (!setter) return fail("This input cannot be filled.");
      target.focus();
      setter.call(target, text);
      target.dispatchEvent(new view.Event("input", { bubbles: true }));
      target.dispatchEvent(new view.Event("change", { bubbles: true }));
      return { ok: true, attempted: true, retained: target.value === text };
    }
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      target.focus();
      target.select?.();
      // insertText produces the trusted beforeinput/input events frameworks expect.
      const inserted = unlocked(view, () => doc.execCommand(text ? "insertText" : "delete", false, text));
      if (!inserted || target.value !== text) {
        const prototype = target.tagName === "INPUT" ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(target, text);
        target.dispatchEvent(new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        target.dispatchEvent(new view.Event("change", { bubbles: true }));
      }
      return { ok: true, attempted: true, retained: target.value === text };
    }
    if (target.isContentEditable) {
      target.focus();
      const selection = view.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = unlocked(view, () => doc.execCommand(text ? "insertText" : "delete", false, text));
      if (!inserted) return { ok: false, attempted: true, error: "The website did not accept the text." };
      const normalize = (value) => value.replace(/\r\n/g, "\n").replace(/ /g, " ").trim();
      // Canvas editors move the text into their own model; inspect, never retype.
      return { ok: true, attempted: true, retained: normalize(target.innerText ?? target.textContent ?? "") === normalize(text) };
    }
    return fail(`${P.describe(el)} is not a text field.`, { errorCode: "browser_target_not_editable" });
  };

  const select = (el, values) => {
    const view = el.ownerDocument.defaultView;
    if (!(el instanceof view.HTMLSelectElement)) {
      // A type-ahead field (an input with suggestions) takes its option as text.
      if (values.length === 1 && el.tagName === "INPUT" && textField(el)) {
        const filled = fill(el, values[0]);
        return filled.ok ? { ...filled, selected: [values[0]] } : filled;
      }
      return fail(`${P.describe(el)} is not a native list. Use browser_skill pickers.choose, or click it and then the option.`);
    }
    if (!el.multiple && values.length !== 1) return fail("Choose exactly one option for this list.");
    const options = Array.from(el.options);
    const chosen = values.map((value) => options.find((option) => !option.disabled && (option.value === value || option.text.trim() === value))
      || options.find((option) => !option.disabled && option.text.trim().toLowerCase() === String(value).toLowerCase()));
    if (chosen.some((option) => !option)) return fail(`Option not found. Available: ${options.slice(0, 20).map((option) => option.text.trim()).join(", ")}`);
    el.focus();
    for (const option of options) option.selected = chosen.includes(option);
    el.dispatchEvent(new view.Event("input", { bubbles: true }));
    el.dispatchEvent(new view.Event("change", { bubbles: true }));
    return { ok: true, attempted: true, selected: chosen.map((option) => option.text.trim()) };
  };

  const checkedState = (el) => el.tagName === "INPUT" ? el.checked : el.getAttribute("aria-checked") === "true";

  const scroll = (el, step) => {
    if (step.direction === "into_view") {
      if (!el) return fail("Give the ref to scroll into view.");
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return { ok: true, attempted: true, scrolled: true };
    }
    const pages = Math.max(0.1, Math.min(10, Number(step.amount) || 1));
    let scroller = el;
    const horizontal = step.direction === "left" || step.direction === "right";
    const sign = step.direction === "up" || step.direction === "left" ? -1 : 1;
    while (scroller) {
      const style = scroller.ownerDocument.defaultView.getComputedStyle(scroller);
      const root = scroller === scroller.ownerDocument.scrollingElement;
      const can = horizontal ? scroller.scrollWidth > scroller.clientWidth + 1 && (root || /(auto|scroll|overlay)/.test(style.overflowX))
        : scroller.scrollHeight > scroller.clientHeight + 1 && (root || /(auto|scroll|overlay)/.test(style.overflowY));
      if (can) break;
      scroller = scroller.parentElement || scroller.ownerDocument.defaultView?.frameElement || null;
    }
    const target = scroller || document.scrollingElement || document.documentElement;
    const isRoot = target === target.ownerDocument.scrollingElement;
    const size = horizontal ? (isRoot ? target.ownerDocument.defaultView.innerWidth : target.clientWidth) : (isRoot ? target.ownerDocument.defaultView.innerHeight : target.clientHeight);
    const before = horizontal ? target.scrollLeft : target.scrollTop;
    const delta = Math.round(sign * pages * size * 0.85);
    target.scrollBy({ left: horizontal ? delta : 0, top: horizontal ? 0 : delta, behavior: "instant" });
    const after = horizontal ? target.scrollLeft : target.scrollTop;
    return { ok: true, attempted: true, scrolled: after !== before, atEnd: !horizontal && Math.ceil(target.scrollTop + target.clientHeight) >= target.scrollHeight - 1 };
  };

  const keyCodes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 };

  /** Finds the control a recorded locator names on the current page. */
  P.locate = (args) => {
    if (!S.documentId || args.documentId !== S.documentId) return { ok: false, attempted: false, errorCode: "browser_snapshot_stale", error: "The page changed since its snapshot. Take a new snapshot." };
    const locator = args.locator || {};
    if (typeof locator.role !== "string" || typeof locator.name !== "string") return { ok: false, attempted: false, error: "A locator has a role and a name." };
    const built = P.build(document, { maxRefs: 2000 });
    const same = (node, exact) => node.role === locator.role && (exact ? node.name === locator.name : node.name.toLowerCase() === locator.name.toLowerCase());
    let matches = built.interactive.filter((node) => same(node, true));
    if (!matches.length) matches = built.interactive.filter((node) => same(node, false));
    const node = matches[Math.min(matches.length - 1, Math.max(0, Number(locator.index) || 0))];
    if (!node) return { ok: false, attempted: false, errorCode: "browser_locator_missing", error: `No ${locator.role} named “${P.clip(locator.name, 60)}” on this page.` };
    return { ok: true, ref: node.ref, ambiguous: matches.length > 1 && locator.index === undefined };
  };

  /** Script side of one step; native clicks and keys never reach here on macOS. */
  P.perform = (args) => {
    const step = args.step;
    const resolved = P.resolve(args.documentId, step.ref);
    if (!resolved.ok) return resolved;
    const el = resolved.el;
    switch (step.action) {
      case "focus": {
        if (!el) return fail("Give the ref to focus.");
        el.focus();
        return { ok: true, attempted: true, focused: el.ownerDocument.activeElement === el || el.contains(el.ownerDocument.activeElement) };
      }
      case "click": {
        if (!el) return fail("Give the ref to click.");
        // As a browser does: each press counts up, a second one adds dblclick,
        // and the right button opens a context menu instead of clicking.
        const count = Math.min(3, Math.max(1, Math.trunc(Number(step.clickCount)) || 1));
        const right = step.button === "right";
        mouse(el, args.point, ["pointerover", "pointerenter", "mouseover", "pointermove", "mousemove"]);
        for (let press = 1; press <= count && el.isConnected; press++) {
          mouse(el, args.point, ["pointerdown", "mousedown", "pointerup", "mouseup", right ? "contextmenu" : "click"], press, right ? 2 : 0);
          if (press === 2 && !right) mouse(el, args.point, ["dblclick"], 2);
        }
        return { ok: true, attempted: true, input: "script" };
      }
      case "check": case "uncheck": {
        if (!el) return fail(`Give the ref to ${step.action}.`);
        const want = step.action === "check";
        if (checkedState(el) === want) return { ok: true, attempted: false, unchanged: true };
        mouse(el, args.point, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
        return { ok: true, attempted: true, input: "script", checked: checkedState(el) };
      }
      case "checked": return { ok: true, checked: el ? checkedState(el) : false };
      case "hover": {
        if (!el) return fail("Give the ref to hover.");
        mouse(el, args.point, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]);
        return { ok: true, attempted: true };
      }
      case "fill": return el ? fill(el, String(step.text ?? "")) : fail("Give the ref of the field to fill.");
      case "select": return el ? select(el, step.values || []) : fail("Give the ref of the list.");
      case "scroll": return scroll(el, step);
      case "key": {
        const target = el || document.activeElement || document.body;
        if (el) el.focus();
        const view = target.ownerDocument.defaultView;
        const key = step.key === "Space" ? " " : step.key;
        const mods = new Set(step.modifiers || []);
        const init = { key, code: step.key.length === 1 ? `Key${step.key.toUpperCase()}` : step.key, keyCode: keyCodes[step.key] ?? step.key.toUpperCase().charCodeAt(0),
          which: keyCodes[step.key] ?? step.key.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, composed: true,
          shiftKey: mods.has("Shift"), ctrlKey: mods.has("Control"), altKey: mods.has("Alt"), metaKey: mods.has("Meta") };
        target.dispatchEvent(new view.KeyboardEvent("keydown", init));
        if (target.isConnected) target.dispatchEvent(new view.KeyboardEvent("keyup", init));
        return { ok: true, attempted: true, input: "script" };
      }
      case "upload": {
        const view = el?.ownerDocument.defaultView;
        if (!el || !(el instanceof view.HTMLInputElement) || el.type !== "file" || el.disabled) return fail("Give the ref of an enabled file input.");
        const file = args.file;
        if (!file || typeof file.base64 !== "string" || typeof file.name !== "string") return fail("The task file is unavailable.");
        const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
        if (bytes.length !== file.byteSize) return fail("The task file size changed.");
        const transfer = new view.DataTransfer();
        transfer.items.add(new view.File([bytes], file.name, { type: file.mimeType }));
        el.files = transfer.files;
        el.dispatchEvent(new view.Event("input", { bubbles: true }));
        el.dispatchEvent(new view.Event("change", { bubbles: true }));
        return { ok: true, attempted: true, inputSelected: el.files?.length === 1 && el.files[0].size === bytes.length, name: file.name, byteSize: bytes.length, websiteUploadVerified: false };
      }
      default: return fail("Unsupported browser step.");
    }
  };
})(globalThis.__mistyAgentPageV1 ??= {});
