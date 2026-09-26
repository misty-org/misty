function guard(locked, view = window, depth = 0) {
  if (depth > 8) return;
  view.__MISTY_AGENT_INPUT_LOCKED__ = locked;
  const visitFrame = frame => {
    try {
      if (frame.contentDocument?.defaultView) guard(view.__MISTY_AGENT_INPUT_LOCKED__, frame.contentDocument.defaultView, depth + 1);
    } catch { /* Never bypass a frame's origin or sandbox boundary. */ }
  };
  for (const frame of view.document.querySelectorAll("iframe,frame")) visitFrame(frame);
  if (view.__MISTY_AGENT_INPUT_GUARD__) return;
  view.__MISTY_AGENT_INPUT_GUARD__ = true;
  view.addEventListener("load", event => {
    if (event.target?.matches?.("iframe,frame")) visitFrame(event.target);
  }, true);
  const observer = new view.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.matches?.("iframe,frame")) visitFrame(node);
      for (const frame of node.querySelectorAll?.("iframe,frame") || []) visitFrame(frame);
    }
  });
  observer.observe(view.document, { childList: true, subtree: true });
  view.__MISTY_AGENT_INPUT_OBSERVER__ = observer;
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'beforeinput', 'paste', 'drop', 'wheel']) {
    view.addEventListener(type, event => {
      if (!view.__MISTY_AGENT_INPUT_LOCKED__) return;
      if (event.isTrusted) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (type === 'click' && event.target instanceof view.HTMLInputElement && event.target.type === 'file') {
        // Agent uploads use inspected file inputs and authorized task receipts.
        // Preserve the site's input and handlers, but do not open an OS picker
        // that the browser agent cannot observe or operate. Human takeover
        // restores the input's ordinary default behavior.
        event.preventDefault();
      }
    }, { capture: true, passive: false });
  }
}
