// A visual receipt of agent pointing, never an input source or permission grant.
(() => {
  const key = Symbol.for("misty.browser.agent.cursor");
  if (window[key]) return;
  let host, timer, placed = false;
  const hide = () => {
    clearTimeout(timer);
    if (host) host.style.opacity = "0";
  };
  const move = (target, y) => {
    try {
      let x = target;
      if (typeof target !== "number") {
        const rect = target?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
        let view = target.ownerDocument?.defaultView;
        while (view && view !== window) {
          const frame = view.frameElement;
          if (!frame) return;
          const outer = frame.getBoundingClientRect();
          const scaleX = frame.offsetWidth ? outer.width / frame.offsetWidth : 1;
          const scaleY = frame.offsetHeight ? outer.height / frame.offsetHeight : 1;
          x = outer.left + (frame.clientLeft + x) * scaleX;
          y = outer.top + (frame.clientTop + y) * scaleY;
          view = frame.ownerDocument.defaultView;
        }
      }
      if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
      if (!host?.isConnected) {
        host = document.createElement("misty-agent-cursor");
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:26px;height:30px;pointer-events:none;z-index:2147483647;opacity:0;contain:strict;";
        const shadow = host.attachShadow({ mode: "closed" });
        shadow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30" viewBox="0 0 26 30" style="display:block;pointer-events:none"><path d="M2 2 L22 17 L13 18 L9 26 Z" fill="#a0c4d4" stroke="#131313" stroke-width="2" stroke-linejoin="round"/></svg>';
        document.documentElement.append(host);
        placed = false;
      }
      // No idle loops or invented movement. Reduced motion keeps the target
      // visible but snaps to it rather than travelling across the page.
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      host.style.transition = placed && !reduced ? "transform 140ms cubic-bezier(0.16,1,0.3,1), opacity 100ms" : "opacity 100ms";
      host.style.transform = `translate3d(${x - 2}px,${y - 2}px,0)`;
      host.style.opacity = "1";
      placed = true;
      clearTimeout(timer);
      timer = setTimeout(hide, 1600);
    } catch { /* Visual feedback must never break the real action. */ }
  };
  window[key] = { move, hide };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", hide);
})();
