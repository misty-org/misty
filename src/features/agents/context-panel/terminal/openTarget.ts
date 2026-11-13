import { openExternalLink } from "@/shared/platform/openExternalLink";
import { useContextPanel } from "../contextPanelStore";
import { filesApi } from "../files/filesApi";
import { useFilesStore } from "../files/filesStore";

/** A file a terminal printed, opened in the panel's editor; a folder is shown in Finder. */
export function openTerminalPath(target: { path: string; isDir: boolean }): void {
  if (target.isDir) {
    void filesApi.reveal(target.path).catch(() => undefined);
    return;
  }
  void useFilesStore.getState().openFile(target.path);
  useContextPanel.getState().show("files");
}

/** A web address a terminal printed, opened the way every link in Misty opens. */
export function openTerminalUrl(url: string): void {
  void openExternalLink(url).catch(() => undefined);
}

/** A typed or selected path, resolved against the terminal's folder when it is relative. */
export function resolveTerminalPath(text: string, cwd: string): string | null {
  const value = text.trim().replace(/^['"]|['"]$/g, "");
  if (!value || value.includes("\n") || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return value;
  if (value.startsWith("~")) return null;
  const relative = value.replace(/^\.\//, "");
  if (!relative || relative.startsWith("../")) return null;
  return `${cwd.replace(/[\\/]+$/, "")}/${relative}`;
}
