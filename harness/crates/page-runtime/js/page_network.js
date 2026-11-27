// Misty page-world network counter: whether the page's own fetch and XMLHttpRequest calls are
// still in flight, for the agent runtime's settle (page_read.js), which lives in its own script
// world and cannot see page scripts. While any request younger than 1.5 s is open, the root
// element carries `data-misty-busy`; requests open longer (streams, long polls) stop counting.
//
// A host installs it at document start in the page's own world, and only where it chooses to:
// unlike the runtime, the page can see it. It misses workers, beacons and image and script
// loads; a host with a native resource-load signal should prefer that.
(() => {
  const key = Symbol.for("misty.network");
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const YOUNG = 1500;
  const open = new Map();
  let next = 0;
  let timer = 0;
  const root = () => document.documentElement;
  const update = () => {
    const now = performance.now();
    let young = false;
    for (const started of open.values()) if (now - started < YOUNG) { young = true; break; }
    const el = root();
    if (el) {
      if (young && !el.hasAttribute("data-misty-busy")) el.setAttribute("data-misty-busy", "");
      if (!young && el.hasAttribute("data-misty-busy")) el.removeAttribute("data-misty-busy");
    }
    clearTimeout(timer);
    // Re-check while requests are open, so one that outlives 1.5 s stops counting.
    if (young) timer = setTimeout(update, 250);
  };
  const begin = () => { const id = ++next; open.set(id, performance.now()); update(); return id; };
  const end = (id) => { open.delete(id); update(); };

  const fetch = window.fetch;
  if (typeof fetch === "function") {
    window.fetch = function (...args) {
      const id = begin();
      let pending;
      try { pending = fetch.apply(this, args); } catch (error) { end(id); throw error; }
      return Promise.resolve(pending).finally(() => end(id));
    };
  }
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const id = begin();
    this.addEventListener("loadend", () => end(id), { once: true });
    try { return send.apply(this, args); } catch (error) { end(id); throw error; }
  };
})();
