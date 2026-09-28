// Shared by the renderer and the native browser's isolated JavaScript evaluation.
// Copy presentation only: scripts, event handlers, forms, and live frames never run in Home.
export function snapshotPage(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const origin = root === doc.documentElement ? { left: 0, top: 0 } : root.getBoundingClientRect();
  const width = root === doc.documentElement ? win.innerWidth : root.clientWidth;
  const height = root === doc.documentElement ? win.innerHeight : root.clientHeight;
  if (width < 8 || height < 8) return null;
  const properties =
    `display position top right bottom left float clear box-sizing width height min-width min-height max-width max-height
    margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
    overflow overflow-x overflow-y flex flex-direction flex-wrap align-items align-self align-content justify-content gap order
    grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow
    font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform text-indent
    white-space word-break overflow-wrap color background-color background-image background-size background-position background-repeat
    border-top border-right border-bottom border-left border-radius border-collapse border-spacing box-shadow opacity visibility
    transform transform-origin z-index object-fit object-position vertical-align list-style`.split(
      /\s+/,
    );
  const excluded = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "BASE",
    "NOSCRIPT",
    "TEMPLATE",
    "IFRAME",
    "FRAME",
    "OBJECT",
    "EMBED",
    "PORTAL",
    "AUDIO",
  ]);
  let count = 0;
  let unsupported = false;
  const safeImage = (value) =>
    /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(value);
  function copy(source) {
    if (source.nodeType === 3) return doc.createTextNode(source.textContent || "");
    if (source.nodeType !== 1) return null;
    if (source.tagName === "IFRAME" && source.getBoundingClientRect().height > 0) unsupported = true;
    if (excluded.has(source.tagName)) return null;
    if (++count > 1800) throw new Error("Page too complex");
    const style = win.getComputedStyle(source);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const rect = source.getBoundingClientRect();
    const visible = rect.bottom > origin.top && rect.top < origin.top + height;
    if (visible && (source.shadowRoot || ["CANVAS", "VIDEO"].includes(source.tagName)))
      unsupported = true;
    // Keep HTML and SVG geometry, but never copy arbitrary attributes or URL actions.
    const tag = source.tagName.toLowerCase();
    const target =
      source.namespaceURI === "http://www.w3.org/2000/svg"
        ? doc.createElementNS(source.namespaceURI, tag)
        : doc.createElement(
            ["html", "body", "form", "input", "textarea", "select"].includes(tag) ||
              tag.includes("-")
              ? "div"
              : tag,
          );
    for (const name of [
      "viewBox",
      "d",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "cx",
      "cy",
      "r",
      "x",
      "y",
      "x1",
      "x2",
      "y1",
      "y2",
      "points",
      "colspan",
      "rowspan",
    ]) {
      const value = source.getAttribute(name);
      if (value && !/url\s*\(/i.test(value)) target.setAttribute(name, value);
    }
    for (const property of properties)
      target.style.setProperty(property, style.getPropertyValue(property));
    target.style.setProperty("animation", "none");
    target.style.setProperty("transition", "none");
    target.style.setProperty("caret-color", "transparent");
    if (source === root) {
      target.style.position = "relative";
      target.style.inset = "auto";
      target.style.transform = "none";
      target.style.margin = "0";
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
    }
    if (tag === "img") {
      const src = source.currentSrc || source.src;
      if (safeImage(src)) target.setAttribute("src", src);
      target.setAttribute("referrerpolicy", "no-referrer");
      target.setAttribute("alt", source.alt || "");
    } else if (tag === "input" || tag === "textarea") {
      target.textContent =
        source.type === "password" ? "••••••••" : source.value || source.placeholder || "";
    } else {
      for (const child of source.childNodes) {
        const cloned = copy(child);
        if (cloned) target.append(cloned);
      }
    }
    // Scroll the inert copy without script, including nested scrolling panels.
    if (source.scrollTop || source.scrollLeft) {
      const content = doc.createElement("div");
      while (target.firstChild) content.append(target.firstChild);
      content.style.transform = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`;
      target.append(content);
    }
    return target;
  }
  try {
    const clone = copy(root);
    if (!clone || unsupported) return null;
    const html = clone.outerHTML;
    if (html.length > 3_000_000) return null;
    const csp =
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return {
      width,
      height,
      html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}*{pointer-events:none!important}::-webkit-scrollbar{display:none}</style></head><body>${html}</body></html>`,
    };
  } catch {
    return null;
  }
}
