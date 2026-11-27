((P) => {
  const S = P.state;
  const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
  const outside = (x, y) => ({
    ok: false, attempted: false, errorCode: "browser_point_outside",
    error: `(${x}, ${y}) is outside the page's view, which is ${innerWidth}×${innerHeight} CSS pixels.`,
  });

  P.pointAt = (args) => {
    const x = Number(args.x);
    const y = Number(args.y);
    if (!inside(x, y)) return outside(x, y);
    const hit = P.deepHit(document, x, y);
    const judged = P.consequenceAt({ x: x / innerWidth, y: y / innerHeight });
    return {
      ok: true,
      point: { x: x / innerWidth, y: y / innerHeight },
      viewport: { width: innerWidth, height: innerHeight },
      editable: P.editable(hit),
      draggable: !!hit?.closest?.('[draggable="true"]'),
      ...judged,
    };
  };

  const at = (x, y) => P.deepHit(document, x, y) || document.body || document.documentElement;
  const mods = (list) => {
    const set = new Set(list || []);
    return { shiftKey: set.has("Shift"), ctrlKey: set.has("Control"), altKey: set.has("Alt"), metaKey: set.has("Meta") };
  };
  const fire = (target, type, x, y, extra = {}) => {
    const view = target.ownerDocument.defaultView;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view, ...extra };
    if (type.startsWith("pointer")) {
      const Pointer = view.PointerEvent || view.MouseEvent;
      return target.dispatchEvent(new Pointer(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, ...init }));
    }
    return target.dispatchEvent(new view.MouseEvent(type, init));
  };
  const moveTo = (x, y, buttons, modifiers) => {
    const target = at(x, y);
    const last = S.pointer?.target;
    if (last && last !== target && last.isConnected) {
      fire(last, "pointerout", x, y, { buttons, ...modifiers });
      fire(last, "mouseout", x, y, { buttons, ...modifiers });
      fire(last, "pointerleave", x, y, { buttons, bubbles: false, ...modifiers });
      fire(last, "mouseleave", x, y, { buttons, bubbles: false, ...modifiers });
    }
    if (last !== target) {
      fire(target, "pointerover", x, y, { buttons, ...modifiers });
      fire(target, "mouseover", x, y, { buttons, ...modifiers });
      fire(target, "pointerenter", x, y, { buttons, bubbles: false, ...modifiers });
      fire(target, "mouseenter", x, y, { buttons, bubbles: false, ...modifiers });
    }
    fire(target, "pointermove", x, y, { buttons, ...modifiers });
    fire(target, "mousemove", x, y, { buttons, ...modifiers });
    S.pointer = { ...(S.pointer || {}), target, x, y };
    return target;
  };
  const press = (x, y, button, detail, modifiers) => {
    const target = moveTo(x, y, 0, modifiers);
    const buttons = button === 2 ? 2 : 1;
    fire(target, "pointerdown", x, y, { button, buttons, detail, ...modifiers });
    fire(target, "mousedown", x, y, { button, buttons, detail, ...modifiers });
    const focusable = target.closest?.("a[href],button,input,select,textarea,[tabindex],[contenteditable]");
    if (focusable && typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
    S.pointer = { ...S.pointer, down: target, button };
    return target;
  };
  const release = (x, y, button, detail, modifiers) => {
    const target = at(x, y);
    fire(target, "pointerup", x, y, { button, buttons: 0, detail, ...modifiers });
    fire(target, "mouseup", x, y, { button, buttons: 0, detail, ...modifiers });
    const down = S.pointer?.down;
    if (down && (down === target || down.contains(target) || target.contains(down))) {
      fire(target, button === 2 ? "contextmenu" : "click", x, y, { button, detail, ...modifiers });
    }
    S.pointer = { ...S.pointer, down: null };
    return target;
  };
  const dragTransfer = (view) => {
    try { return new view.DataTransfer(); } catch { return null; }
  };
  const draggable = (el) => el?.closest?.('[draggable="true"],a[href],img');

  P.pointer = (args) => {
    const kind = String(args.kind || "");
    const x = Number(args.x);
    const y = Number(args.y);
    const button = args.button === "right" ? 2 : args.button === "middle" ? 1 : 0;
    const modifiers = mods(args.modifiers);
    if (kind !== "up" && kind !== "down" && kind !== "wheel" && !inside(x, y)) return outside(x, y);
    switch (kind) {
      case "move": {
        moveTo(x, y, S.pointer?.down ? 1 : 0, modifiers);
        return { ok: true, attempted: true, input: "script" };
      }
      case "click": {
        const count = Math.min(3, Math.max(1, Math.trunc(Number(args.clickCount)) || 1));
        let target = null;
        for (let detail = 1; detail <= count; detail++) {
          press(x, y, button, detail, modifiers);
          target = release(x, y, button, detail, modifiers);
        }
        if (count === 2 && button === 0) fire(target, "dblclick", x, y, { detail: 2, ...modifiers });
        return { ok: true, attempted: true, input: "script" };
      }
      case "down": {
        const px = inside(x, y) ? x : S.pointer?.x ?? innerWidth / 2;
        const py = inside(x, y) ? y : S.pointer?.y ?? innerHeight / 2;
        press(px, py, button, 1, modifiers);
        return { ok: true, attempted: true, input: "script" };
      }
      case "up": {
        const px = inside(x, y) ? x : S.pointer?.x ?? innerWidth / 2;
        const py = inside(x, y) ? y : S.pointer?.y ?? innerHeight / 2;
        if (inside(x, y)) moveTo(px, py, 1, modifiers);
        release(px, py, button, 1, modifiers);
        return { ok: true, attempted: true, input: "script" };
      }
      case "wheel": {
        const px = inside(x, y) ? x : innerWidth / 2;
        const py = inside(x, y) ? y : innerHeight / 2;
        const target = at(px, py);
        const deltaX = Number(args.deltaX) || 0;
        const deltaY = Number(args.deltaY) || 0;
        const view = target.ownerDocument.defaultView;
        const proceed = target.dispatchEvent(new view.WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, deltaX, deltaY, deltaMode: 0, ...modifiers }));
        let box = target;
        const scrolls = (el) => {
          const style = getComputedStyle(el);
          return (deltaY && el.scrollHeight > el.clientHeight + 1 && /(auto|scroll|overlay)/.test(style.overflowY))
            || (deltaX && el.scrollWidth > el.clientWidth + 1 && /(auto|scroll|overlay)/.test(style.overflowX));
        };
        while (box && box !== document.documentElement && !scrolls(box)) box = box.parentElement;
        const scroller = box && box !== document.documentElement ? box : document.scrollingElement || document.documentElement;
        const before = [scroller.scrollLeft, scroller.scrollTop];
        if (proceed) scroller.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
        const moved = scroller.scrollLeft !== before[0] || scroller.scrollTop !== before[1];
        return { ok: true, attempted: true, input: "script", scrolled: moved };
      }
      case "drag": {
        const toX = Number(args.toX);
        const toY = Number(args.toY);
        if (!inside(toX, toY)) return outside(toX, toY);
        const source = press(x, y, 0, 1, modifiers);
        const steps = 8;
        for (let index = 1; index <= steps; index++) {
          moveTo(x + ((toX - x) * index) / steps, y + ((toY - y) * index) / steps, 1, modifiers);
        }
        const html = draggable(source);
        if (html) {
          const view = html.ownerDocument.defaultView;
          const transfer = dragTransfer(view);
          const drag = (el, type, px, py) => el.dispatchEvent(new view.DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, dataTransfer: transfer }));
          if (drag(html, "dragstart", x, y)) {
            const target = at(toX, toY);
            drag(target, "dragenter", toX, toY);
            const over = drag(target, "dragover", toX, toY);
            if (!over) drag(target, "drop", toX, toY);
            drag(html, "dragend", toX, toY);
          }
        }
        S.pointer = { ...S.pointer, down: null };
        const end = at(toX, toY);
        fire(end, "pointerup", toX, toY, { button: 0, buttons: 0, ...modifiers });
        fire(end, "mouseup", toX, toY, { button: 0, buttons: 0, ...modifiers });
        return { ok: true, attempted: true, input: "script", html5: !!html };
      }
      default:
        return { ok: false, attempted: false, error: `Unknown pointer action ${kind}.` };
    }
  };

  P.region = (args) => {
    const view = { width: innerWidth, height: innerHeight };
    const root = document.scrollingElement || document.documentElement;
    const page = { width: Math.max(root.scrollWidth, innerWidth), height: Math.max(root.scrollHeight, innerHeight) };
    if (args.ref) {
      const resolved = P.resolve(args.documentId, args.ref);
      if (!resolved.ok) return resolved;
      const el = resolved.el;
      if (!el) return { ok: false, attempted: false, error: "Give the ref to picture." };
      let box = el.getBoundingClientRect();
      if (box.top < 0 || box.left < 0 || box.bottom > innerHeight || box.right > innerWidth) {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        box = el.getBoundingClientRect();
      }
      const x = Math.max(0, box.left);
      const y = Math.max(0, box.top);
      const width = Math.min(innerWidth, box.right) - x;
      const height = Math.min(innerHeight, box.bottom) - y;
      if (width < 1 || height < 1) return { ok: false, attempted: false, error: `${P.describe(el)} has nothing to picture.` };
      return { ok: true, x, y, width, height, view, page, describe: P.describe(el) };
    }
    if (args.fullPage) return { ok: true, x: 0, y: 0, width: innerWidth, height: page.height, view, page, scrolled: { x: scrollX, y: scrollY } };
    return { ok: true, x: 0, y: 0, width: innerWidth, height: innerHeight, view, page };
  };

  P.scrollToY = (args) => {
    window.scrollTo({ left: Number(args.x) || 0, top: Number(args.y) || 0, behavior: "instant" });
    return { ok: true, x: scrollX, y: scrollY };
  };

  P.compose = (args) => new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(args.width);
    canvas.height = Math.round(args.height);
    const context = canvas.getContext("2d");
    const tiles = args.tiles || [];
    let left = tiles.length;
    const finish = () => {
      const type = args.type === "jpeg" ? "image/jpeg" : "image/png";
      resolve({ ok: true, dataUrl: canvas.toDataURL(type, 0.85), width: canvas.width, height: canvas.height });
    };
    if (!left) return finish();
    for (const tile of tiles) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, Math.round(tile.y));
        if (--left === 0) finish();
      };
      image.onerror = () => { if (--left === 0) finish(); };
      image.src = tile.dataUrl;
    }
  });

  P.dropFiles = (args) => {
    const resolved = P.resolve(args.documentId, args.ref);
    if (!resolved.ok) return resolved;
    const el = resolved.el;
    if (!el) return { ok: false, attempted: false, error: "Give the ref to drop on." };
    const view = el.ownerDocument.defaultView;
    const transfer = dragTransfer(view);
    if (!transfer) return { ok: false, attempted: false, error: "This page can't take dropped files." };
    for (const file of args.files || []) {
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      transfer.items.add(new view.File([bytes], file.name, { type: file.mimeType || "" }));
    }
    for (const [type, value] of Object.entries(args.data || {})) transfer.setData(type, String(value));
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const send = (type) => el.dispatchEvent(new view.DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: transfer }));
    send("dragenter");
    const over = send("dragover");
    send("drop");
    return { ok: true, attempted: true, dropped: (args.files || []).map((file) => file.name), accepted: !over };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
