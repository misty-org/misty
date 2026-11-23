function findOpaqueBrowserPageAncestors(root: ParentNode = document): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const host of root.querySelectorAll<HTMLElement>("[data-browser-page-host]")) {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    for (let node: HTMLElement | null = host; node; node = node.parentElement) {
      if (paintsBackground(getComputedStyle(node))) found.add(node);
    }
  }
  return [...found];
}

function paintsBackground(style: CSSStyleDeclaration) {
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  const color = style.backgroundColor;
  if (!color || color === "transparent") return false;
  const alpha = color.match(/rgba?\([^)]*[,/]\s*([\d.]+%?)\s*\)/)?.[1];
  if (alpha === undefined) return true;
  return parseFloat(alpha) > 0;
}

function describe(element: HTMLElement) {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.name.startsWith("data-") || attribute.name === "class")
    .map((attribute) =>
      attribute.name === "class"
        ? `.${attribute.value.trim().split(/\s+/).join(".")}`
        : `[${attribute.name}]`,
    );
  return `<${element.tagName.toLowerCase()}${attributes.join("")}>`;
}

export function checkBrowserOverlayTransparency(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const opaque = findOpaqueBrowserPageAncestors();
    if (!opaque.length) return;
    console.warn(
      "Browser pages are hidden while this overlay is open: these elements paint a background " +
        "behind a page. Keep them transparent and paint only outside the page (margins, gaps, " +
        "corners).",
      opaque.map(describe),
      opaque,
    );
  });
}
