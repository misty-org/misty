import { openExternalLink } from "@/shared/platform/open_external_link";
import { useContextPanel } from "../context_panel_store";
import { filesApi } from "../files/files_api";
import { useFilesStore } from "../files/files_store";
import { notify } from "@misty/ui";

export function openTerminalPath(target: { path: string; isDir: boolean }): void {
  if (target.isDir) {
    void filesApi
      .reveal(target.path)
      .catch(() => notify({ message: "Couldn't show that folder.", tone: "error" }));
    return;
  }
  void useFilesStore.getState().openFile(target.path);
  useContextPanel.getState().show("files");
}

export function openTerminalUrl(url: string): void {
  void openExternalLink(url).catch(() =>
    notify({ message: "Couldn't open that link.", tone: "error" }),
  );
}

export function resolveTerminalPath(text: string, cwd: string): string | null {
  const value = text.trim().replace(/^['"]|['"]$/g, "");
  if (!value || value.includes("\n") || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return value;
  if (value.startsWith("~")) return null;
  const relative = value.replace(/^\.\//, "");
  if (!relative || relative.startsWith("../")) return null;
  return `${cwd.replace(/[\\/]+$/, "")}/${relative}`;
}
