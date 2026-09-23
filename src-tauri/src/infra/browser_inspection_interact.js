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
    if (target && (!element?.isConnected || element.ownerDocument !== record.document || !record.isCurrent() ||
      record.readFingerprint(element) !== record.fingerprint))
      return { ok: false, errorCode: "browser_snapshot_stale", error: "The inspected control changed. Inspect the page again before acting." };
    if (element && (element.disabled || element.readOnly || /^(password|hidden|file)$/i.test(element.getAttribute("type") || "")))
      return { ok: false, error: "This control requires user interaction." };
    const owner = element?.ownerDocument || document;
    const view = owner.defaultView;
    // Consume the entire snapshot before an action, including a failed attempt.
    snapshot.consumed = true;
    targets?.clear();
    switch (action.kind) {
      case "point": {
        if(![action.x,action.y].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=1))throw new Error("Point coordinates must be within the inspected viewport.");
        const x=action.x*innerWidth,y=action.y*innerHeight;
        let pointX=x,pointY=y,pointDocument=document;
        const pointFrames=[];
        let pointed=pointDocument.elementFromPoint(pointX,pointY);
        for(let depth=0; pointed && /^(IFRAME|FRAME)$/.test(pointed.tagName); depth++) {
          if(depth>=8)throw new Error("The frame nesting exceeds supported interaction depth.");
          const child=pointed.contentDocument;
          if(!child?.defaultView)throw new Error("This frame requires human interaction.");
          pointFrames.push([pointed,child]);
          const rect=pointed.getBoundingClientRect();
          const scaleX=pointed.offsetWidth ? rect.width/pointed.offsetWidth : 1;
          const scaleY=pointed.offsetHeight ? rect.height/pointed.offsetHeight : 1;
          if(!(scaleX>0 && scaleY>0))throw new Error("The frame is not visible.");
          pointX=(pointX-rect.left)/scaleX-pointed.clientLeft;
          pointY=(pointY-rect.top)/scaleY-pointed.clientTop;
          pointDocument=child;
          pointed=child.elementFromPoint(pointX,pointY);
        }
        if(!pointed||pointed.closest('input[type="password"],input[type="file"]'))throw new Error("This point requires human interaction.");
        window[Symbol.for("misty.browser.agent.cursor")]?.move(x,y);
        const pointView=pointDocument.defaultView;
        const pointStillCurrent=()=>pointed.isConnected && pointFrames.every(([frame,child])=>frame.isConnected && frame.contentDocument===child);
        const Pointer=pointView.PointerEvent || PointerEvent, Mouse=pointView.MouseEvent;
        const mouse = { clientX: pointX, clientY: pointY, bubbles: true, cancelable: true, composed: true, button: 0 };
        const compatibilityMouse = pointed.dispatchEvent(new Pointer("pointerdown", { ...mouse, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        if (compatibilityMouse) pointed.dispatchEvent(new Mouse("mousedown", { ...mouse, buttons: 1 }));
        if (pointStillCurrent()) {
          pointed.dispatchEvent(new Pointer("pointerup", { ...mouse, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
          if (compatibilityMouse) pointed.dispatchEvent(new Mouse("mouseup", { ...mouse, buttons: 0 }));
          if (pointStillCurrent()) pointed.dispatchEvent(new Mouse("click", { ...mouse, buttons: 0, detail: 1 }));
        }
        break;
      }
      case "fill": {
        if (typeof action.text !== "string" || action.text.length > 65536) throw new Error("Invalid text input.");
        if (element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement) {
          const prototype = element instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) throw new Error("This input cannot be filled.");
          element.focus();
          setter.call(element, action.text);
        } else if (element?.isContentEditable) {
          element.focus();
          const selection = view.getSelection(), range = owner.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          // Rich editors reconcile direct DOM mutations away. Use the browser's
          // editing transaction, allowing its synchronous trusted beforeinput.
          // Physical input cannot interleave within this JavaScript task.
          const locked = view.__MISTY_AGENT_INPUT_LOCKED__;
          try {
            view.__MISTY_AGENT_INPUT_LOCKED__ = false;
            if (!owner.execCommand("insertText", false, action.text))
              throw new Error("The website did not accept the text input.");
          } finally {
            view.__MISTY_AGENT_INPUT_LOCKED__ = locked;
          }
          window[Symbol.for("misty.browser.agent.cursor")]?.move(element);
          // Canvas editors consume this temporary editable buffer into their
          // document model. A successful editing transaction is an attempt, not
          // proof the document saved. Never repeat it merely because the buffer
          // was cleared; inspect the rendered document before continuing.
          return { ok: true, attempted: true,
            textRetained: element.innerText.replace(/\r\n/g, "\n") === action.text.replace(/\r\n/g, "\n"),
            websiteEditVerified: false };
        } else throw new Error("The inspected control is not editable.");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        window[Symbol.for("misty.browser.agent.cursor")]?.move(element);
        break;
      }
      case "select": {
        if (!(element instanceof view.HTMLSelectElement) || !Array.isArray(action.values) || !action.values.length || action.values.length > 100 || (!element.multiple && action.values.length !== 1)) throw new Error("Invalid selection.");
        if (action.values.some(value => typeof value !== "string" || value.length > 1000 || !Array.from(element.options).some(option => option.value === value && !option.disabled))) throw new Error("An option is unavailable.");
        for (const option of element.options) option.selected = action.values.includes(option.value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        window[Symbol.for("misty.browser.agent.cursor")]?.move(element);
        break;
      }
      case "scroll": {
        if (![action.x, action.y].every(value => Number.isInteger(value) && Math.abs(value) <= 4000)) throw new Error("Invalid scroll distance.");
        // Match scrolling over a control: its nearest scrollable ancestor owns
        // the movement, including the containing page of an accessible frame.
        if (!element) {
          const beforeX = window.scrollX, beforeY = window.scrollY;
          window.scrollBy({ left: action.x, top: action.y, behavior: "instant" });
          return { ok: true, attempted: true, scrolled: window.scrollX !== beforeX || window.scrollY !== beforeY };
        }
        let scroller = element;
        while (scroller) {
          const style = scroller.ownerDocument.defaultView.getComputedStyle(scroller);
          const root = scroller === scroller.ownerDocument.scrollingElement;
          const horizontal = action.x !== 0 && scroller.scrollWidth > scroller.clientWidth + 1 &&
            (root || /^(auto|scroll|overlay)$/.test(style.overflowX));
          const vertical = action.y !== 0 && scroller.scrollHeight > scroller.clientHeight + 1 &&
            (root || /^(auto|scroll|overlay)$/.test(style.overflowY));
          if (horizontal || vertical) break;
          scroller = scroller.parentElement || scroller.ownerDocument.defaultView?.frameElement;
        }
        if (!scroller) return { ok: true, attempted: true, scrolled: false };
        const beforeX = scroller.scrollLeft, beforeY = scroller.scrollTop;
        scroller.scrollBy({ left: action.x, top: action.y, behavior: "instant" });
        window[Symbol.for("misty.browser.agent.cursor")]?.move(element || scroller);
        return { ok: true, attempted: true,
          scrolled: scroller.scrollLeft !== beforeX || scroller.scrollTop !== beforeY };
      }
      case "key": {
        if (!element || !["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(action.key)) throw new Error("Unsupported key.");
        element.focus();
        window[Symbol.for("misty.browser.agent.cursor")]?.move(element);
        // Synthetic keys do not reproduce every browser default. The caller must
        // inspect the result rather than assuming a form submitted or focus moved.
        const keyCode = { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40,
          ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 }[action.key];
        // Older web-app keyboard handlers still read keyCode/which.
        const keyboard = { key: action.key, code: action.key, keyCode, which: keyCode,
          bubbles: true, cancelable: true, composed: true };
        element.dispatchEvent(new KeyboardEvent("keydown", keyboard));
        if (element.isConnected) element.dispatchEvent(new KeyboardEvent("keyup", keyboard));
        break;
      }
      default: throw new Error("Unsupported browser interaction.");
    }
    return { ok: true, attempted: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
