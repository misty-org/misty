// Keep utility-based labels (including portaled menus) in sync with their real
// available width. One observer is shared by the whole app, not one per row.
const candidates =
  '[class*="truncate"], [class*="text-ellipsis"], [class*="line-clamp-1"], .pointer-pane-title';
const marker = "data-overflow-fade";

export function installOverflowFade(root: HTMLElement = document.body) {
  const tracked = new Set<HTMLElement>();
  const pending = new Set<HTMLElement>();
  let frame = 0;
  let disposed = false;

  const flush = () => {
    frame = 0;
    // Read all dimensions before writing masks to avoid layout thrashing.
    const updates = [...pending].map((element) => {
      const style = getComputedStyle(element);
      const enabled = style.getPropertyValue("--misty-overflow-fade").trim() === "1";
      const overflowing =
        enabled && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      return {
        element,
        enabled,
        value: overflowing ? (style.direction === "rtl" ? "left" : "right") : "none",
      };
    });
    pending.clear();
    for (const { element, enabled, value } of updates) {
      if (!root.contains(element) || !enabled) {
        tracked.delete(element);
        resize?.unobserve(element);
        element.removeAttribute(marker);
      } else if (element.getAttribute(marker) !== value) {
        element.setAttribute(marker, value);
      }
    }
  };

  const restyled = new Set<Element>();
  let idle = 0;
  const recheckRestyled = () => {
    idle = 0;
    for (const label of tracked)
      for (const element of restyled)
        if (element.contains(label)) {
          queue(label);
          break;
        }
    restyled.clear();
  };

  const queue = (element: HTMLElement) => {
    pending.add(element);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const resize =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) queue(entry.target as HTMLElement);
        });

  const inspect = (element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    if (getComputedStyle(element).getPropertyValue("--misty-overflow-fade").trim() !== "1") return;
    if (!tracked.has(element)) {
      tracked.add(element);
      resize?.observe(element);
    }
    queue(element);
  };
  const inspectCandidate = (element: Element) => {
    inspect(element);
    // Tailwind descendant variants can apply truncation to unclassed children.
    if (element.className.toString().includes(":")) {
      element.querySelectorAll("*").forEach(inspect);
    }
  };
  const discover = (node: Element) => {
    if (node.matches(candidates)) inspectCandidate(node);
    node.querySelectorAll(candidates).forEach(inspectCandidate);
    if (node.parentElement?.closest(candidates)) {
      inspect(node);
      node.querySelectorAll("*").forEach(inspect);
    }
  };
  const refresh = () => {
    discover(root);
    tracked.forEach(queue);
  };
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (!element) continue;
      // Text changes can alter scrollWidth without resizing the label itself.
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        if (tracked.has(parent as HTMLElement)) queue(parent as HTMLElement);
      }
      if (record.type === "childList") {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) discover(node);
        });
      } else if (record.attributeName === "class" || record.attributeName === "style") {
        // Only the changed element can start or stop being a label; nothing below it changed.
        // Searching its whole subtree read the style of every label on a page each time a tab
        // or panel was shown or hidden, in the middle of the switch.
        if (element.matches(candidates)) inspectCandidate(element);
        else if (element.parentElement?.closest(candidates)) inspect(element);
        // A style change above a label can still change its text width. A class that styles
        // its descendants (a `[&>…]:` variant, before or after) is rechecked at once; any other
        // is checked once the app is idle, so showing a whole page waits on none of its labels.
        const variants =
          (record.oldValue ?? "").includes(":") || element.className.toString().includes(":");
        if (record.attributeName === "class" && variants) {
          for (const label of tracked) if (element.contains(label)) queue(label);
        } else {
          restyled.add(element);
          if (!idle) idle = whenIdle(recheckRestyled);
        }
      } else if (record.attributeName === "dir") {
        refresh();
      }
    }
    for (const element of tracked) {
      if (!root.contains(element)) {
        resize?.unobserve(element);
        tracked.delete(element);
        pending.delete(element);
        element.removeAttribute(marker);
      }
    }
  });

  discover(root);
  mutations.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["class", "style", "dir"],
  });
  window.addEventListener("resize", refresh);
  document.fonts?.addEventListener?.("loadingdone", refresh);
  void document.fonts?.ready?.then?.(() => {
    if (!disposed) refresh();
  });

  return () => {
    disposed = true;
    mutations.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    cancelIdle(idle);
    window.removeEventListener("resize", refresh);
    document.fonts?.removeEventListener?.("loadingdone", refresh);
    tracked.forEach((element) => element.removeAttribute(marker));
    tracked.clear();
    pending.clear();
  };
}

function whenIdle(run: () => void): number {
  return typeof requestIdleCallback === "function"
    ? requestIdleCallback(run, { timeout: 1000 })
    : window.setTimeout(run, 200);
}

function cancelIdle(handle: number) {
  if (!handle) return;
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}
