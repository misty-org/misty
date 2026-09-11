// The control ring on engines without a native page overlay (WebView2): an
// inner mist along the page's edges while an agent controls it. It never
// takes input and stays out of the page's layout.
(active => {
  const id = "misty-agent-ring";
  const existing = document.getElementById(id);
  if (!active) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const ring = document.createElement("div");
  ring.id = id;
  ring.setAttribute("aria-hidden", "true");
  const style = ring.style;
  style.setProperty("position", "fixed", "important");
  style.setProperty("inset", "0", "important");
  style.setProperty("pointer-events", "none", "important");
  style.setProperty("z-index", "2147483647", "important");
  // A bright fog close to the edge and a wide pale-gray one that still reads on white pages.
  style.setProperty("box-shadow", "inset 0 0 18px 2px rgba(255,255,255,.55), inset 0 0 46px 6px rgba(158,158,158,.22)", "important");
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ring.animate(
      [{ opacity: 0.8 }, { opacity: 1 }],
      { duration: 3500, direction: "alternate", iterations: Infinity, easing: "ease-in-out" },
    );
  }
  (document.body || document.documentElement).appendChild(ring);
})
