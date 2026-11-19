/*
 * A drawn chart saved as a picture: its SVG as Recharts drew it, with the page's ink written
 * in, so the file looks the same outside the app; or that SVG drawn onto a canvas as a PNG.
 */

function chartSvg(container: HTMLElement): SVGSVGElement {
  const svg =
    container.querySelector<SVGSVGElement>("svg.recharts-surface") ??
    container.querySelector("svg");
  if (!svg) throw new Error("The chart isn't drawn yet.");
  return svg;
}

/** The chart as a standalone SVG document. */
export function chartSvgText(
  container: HTMLElement,
  background?: string,
): { text: string; width: number; height: number } {
  const svg = chartSvg(container);
  const box = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const ink = getComputedStyle(svg).color || "#000";
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.style.color = ink;
  clone.style.fontFamily = getComputedStyle(svg).fontFamily;
  if (background) {
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    fill.setAttribute("width", "100%");
    fill.setAttribute("height", "100%");
    fill.setAttribute("fill", background);
    clone.insertBefore(fill, clone.firstChild);
  }
  // The legend is HTML beside the SVG; its entries are written into the picture as text.
  const legend = [...container.querySelectorAll<HTMLElement>(".recharts-legend-item")];
  legend.forEach((item, index) => {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(12 + index * 120));
    label.setAttribute("y", String(height - 6));
    label.setAttribute("font-size", "12");
    label.setAttribute(
      "fill",
      getComputedStyle(item.querySelector("svg path, svg") ?? item).color || ink,
    );
    label.textContent = `● ${item.textContent ?? ""}`;
    clone.appendChild(label);
  });
  return { text: new XMLSerializer().serializeToString(clone), width, height };
}

export function chartSvgBlob(container: HTMLElement): Blob {
  return new Blob([chartSvgText(container).text], { type: "image/svg+xml" });
}

/** The chart as a PNG at twice its size, on the page's own background. */
export async function chartPngBlob(container: HTMLElement): Promise<Blob> {
  const background = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const { text, width, height } = chartSvgText(container, background);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The chart couldn't be drawn as a picture."));
      image.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The chart couldn't be drawn as a picture.");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The chart couldn't be saved."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
