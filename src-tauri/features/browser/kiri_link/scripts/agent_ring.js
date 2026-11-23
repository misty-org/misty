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
  style.setProperty("box-shadow", "inset 0 0 18px 2px rgba(255,255,255,.55), inset 0 0 46px 6px rgba(158,158,158,.22)", "important");
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ring.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: 2400, direction: "alternate", iterations: Infinity, easing: "ease-in-out" },
    );
  }
  (document.body || document.documentElement).appendChild(ring);
})
