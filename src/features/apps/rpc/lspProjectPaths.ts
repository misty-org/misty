const uriFields = new Set([
  "uri",
  "rootUri",
  "targetUri",
  "oldUri",
  "newUri",
  "documentUri",
  "scopeUri",
]);
const textFields = new Set([
  "text",
  "newText",
  "message",
  "documentation",
  "detail",
  "label",
  "tooltip",
  "value",
]);

function absolutePath(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Invalid language-server project path.");
  return path === "/" ? path : path.replace(/\/+$/, "");
}
function fileUri(path: string) {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}
function uriPath(uri: string) {
  const url = new URL(uri);
  if (
    url.protocol !== "file:" ||
    (url.hostname && url.hostname !== "localhost") ||
    url.search ||
    url.hash
  )
    throw new Error("Expected a local file URI without a query or fragment.");
  // Check the unnormalized path as URL parsing otherwise removes dot segments.
  const raw = uri.replace(/^file:\/\/[^/]*/i, "");
  absolutePath(decodeURIComponent(raw));
  return absolutePath(decodeURIComponent(url.pathname));
}

/** The host owns this mapping. It never rewrites source text or diagnostic prose.
 * File URIs outside the project are left explicit; this mapper grants no file access. */
export function createLspProjectPaths(virtualRoot: string, nativeRoot: string) {
  const virtual = absolutePath(virtualRoot),
    native = absolutePath(nativeRoot);
  const translatePath = (value: string, from: string, to: string) => {
    const path = absolutePath(value);
    if (path === from) return to;
    const prefix = from === "/" ? "/" : `${from}/`;
    return path.startsWith(prefix) ? `${to === "/" ? "" : to}/${path.slice(prefix.length)}` : path;
  };
  const translateUri = (value: string, from: string, to: string) => {
    if (!/^file:/i.test(value)) return value;
    const path = uriPath(value),
      translated = translatePath(path, from, to);
    return translated === path ? value : fileUri(translated);
  };
  const translate = <T>(message: T, from: string, to: string): T => {
    let nodes = 0;
    const visit = (value: unknown, key = "", depth = 0, commandArgument = false): unknown => {
      if (++nodes > 200_000 || depth > 64)
        throw new Error("Language-server message is too complex.");
      if (typeof value === "string") {
        if (uriFields.has(key) || commandArgument) return translateUri(value, from, to);
        if (key === "rootPath") return translatePath(value, from, to);
        return value;
      }
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value))
        return value.map((item) => visit(item, key, depth + 1, commandArgument));
      const result: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value)) {
        const outputKey =
          key === "changes" && /^file:/i.test(name) ? translateUri(name, from, to) : name;
        if (Object.prototype.hasOwnProperty.call(result, outputKey))
          throw new Error("Language-server document keys collide after translation.");
        // defineProperty preserves data keys such as __proto__ without changing prototypes.
        Object.defineProperty(result, outputKey, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: textFields.has(name)
            ? child
            : visit(child, name, depth + 1, commandArgument || name === "arguments"),
        });
      }
      return result;
    };
    return visit(message) as T;
  };
  return {
    toNative: <T>(message: T) => translate(message, virtual, native),
    toApp: <T>(message: T) => translate(message, native, virtual),
  };
}
