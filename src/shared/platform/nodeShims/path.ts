// POSIX path helpers for Midscene code paths that only build names.
export const sep = "/";
const normalize = (value: string) => {
  const absolute = value.startsWith("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/") || (absolute ? "/" : ".");
};
export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join("/"));
export const resolve = (...parts: string[]) => {
  let path = "";
  for (const part of parts) path = part.startsWith("/") ? part : `${path}/${part}`;
  return normalize(path.startsWith("/") ? path : `/${path}`);
};
export const isAbsolute = (value: string) => value.startsWith("/");
export const dirname = (value: string) => {
  const index = normalize(value).lastIndexOf("/");
  return index <= 0 ? (value.startsWith("/") ? "/" : ".") : normalize(value).slice(0, index);
};
export const basename = (value: string, ext = "") => {
  const name = normalize(value).split("/").pop() ?? "";
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
};
export const extname = (value: string) => {
  const name = basename(value);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
};
export const relative = (from: string, to: string) => {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => ".."), ...b].join("/");
};
const path = { sep, join, resolve, isAbsolute, dirname, basename, extname, relative, normalize };
export { normalize };
export default path;
