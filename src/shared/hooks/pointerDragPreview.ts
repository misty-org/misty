let previewSequence = 0;

/** Freeze the painted row before detaching it from ancestor styles and hover state. */
export function createDragPreview(surface: HTMLElement) {
  const rect = surface.getBoundingClientRect();
  const copy = surface.cloneNode(true) as HTMLElement;
  const originals = [surface, ...surface.querySelectorAll<HTMLElement | SVGElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement | SVGElement>("*")];
  const prefix = `reorder-preview-${++previewSequence}-`;
  const ids = new Map(
    originals.filter((node) => node.id).map((node) => [node.id, prefix + node.id]),
  );
  originals.forEach((node, index) => {
    const clone = copies[index];
    const style = getComputedStyle(node);
    for (const property of Array.from(style))
      clone.style.setProperty(property, style.getPropertyValue(property));
    clone.style.transition = "none";
    clone.style.animation = "none";
    // Keep SVG references local to the copy without duplicating live control IDs.
    for (const attribute of [...clone.attributes]) {
      if (attribute.name.startsWith("data-reorder-") || attribute.name === "autofocus") {
        clone.removeAttribute(attribute.name);
      } else if (attribute.name === "id") {
        clone.id = ids.get(attribute.value)!;
      } else {
        const value = attribute.value.replace(
          /url\(["']?#([^)'"\s]+)["']?\)/g,
          (match, id: string) => (ids.has(id) ? `url(#${ids.get(id)})` : match),
        );
        clone.setAttribute(
          attribute.name,
          value.startsWith("#") && ids.has(value.slice(1)) ? `#${ids.get(value.slice(1))}` : value,
        );
      }
    }
  });
  Object.assign(copy.style, {
    position: "relative",
    inset: "auto",
    margin: "0",
    transform: "none",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    minWidth: "0",
    maxWidth: "none",
    maxHeight: "none",
    boxSizing: "border-box",
  });
  const preview = document.createElement("div");
  preview.className = "pointer-reorder-preview";
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.append(copy);
  return { preview, rect };
}
