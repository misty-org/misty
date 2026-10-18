/**
 * While a popover, menu or dialog is open, native pages drop below the app's renderer and show
 * only through transparent CSS. Any ancestor of a page host that paints a background then hides
 * the page for as long as the overlay stays open. This development check names the culprits
 * each time the overlay rises, so a stray fill is caught where it is introduced.
 */
export function findOpaqueBrowserPageAncestors(root: ParentNode = document): HTMLElement[] {
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
  // After the overlay attribute's styles apply.
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
