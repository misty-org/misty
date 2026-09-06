import type { SdkFilesDirectory } from "./sdkFilesDirectory";
type Folder = Pick<SdkFilesDirectory, "root" | "name">;
const contains = (folder: Folder, path: string) =>
  path === folder.root || path.startsWith(`${folder.root}/`);
export function sdkFilesPathPresentation(folders: Folder[], path: string) {
  const special: Record<string, string> = {
    "misty://trash": "Trash",
    "misty://recent": "Recent",
    "misty://starred": "Starred",
  };
  if (special[path])
    return { displayPath: special[path], breadcrumbs: [{ label: special[path], path }] };
  const folder = folders.find((folder) => contains(folder, path));
  if (!folder) return { displayPath: "", breadcrumbs: [] };
  const parts = path.slice(folder.root.length).split("/").filter(Boolean);
  let current = folder.root;
  return {
    displayPath: [folder.name, ...parts].join("/"),
    breadcrumbs: [
      { label: folder.name, path: folder.root },
      ...parts.map((label) => ({ label, path: (current += `/${label}`) })),
    ],
  };
}
export function resolveSdkFilesPath(folders: Folder[], currentPath: string, input: string): string {
  const value = input.trim().replace(/\/+$/, "");
  if (["misty://recent", "misty://starred"].includes(value)) return value;
  if (
    value === "misty://trash" ||
    (value === "Trash" &&
      (currentPath === "misty://trash" || !folders.some((folder) => folder.name === "Trash")))
  )
    return "misty://trash";
  let folder = folders.find((folder) => contains(folder, value));
  let relative: string;
  if (folder) relative = value.slice(folder.root.length);
  else {
    const candidates = folders.filter(
      (folder) => value === folder.name || value.startsWith(`${folder.name}/`),
    );
    const current = folders.find((folder) => contains(folder, currentPath));
    folder =
      candidates.find((folder) => folder === current) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (folder) relative = value.slice(folder.name.length);
    else if (!value.startsWith("/") && candidates.length === 0 && current) {
      folder = current;
      relative = `${currentPath.slice(current.root.length)}/${value}`;
    } else throw new Error("Choose the folder before navigating to this path.");
  }
  const parts: string[] = [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("This path is outside the chosen folder.");
      parts.pop();
    } else {
      if (part.includes("\0")) throw new Error("Invalid folder path.");
      parts.push(part);
    }
  }
  return `${folder.root}${parts.length ? `/${parts.join("/")}` : ""}`;
}
