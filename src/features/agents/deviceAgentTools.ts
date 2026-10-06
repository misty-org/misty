import { invoke } from "@tauri-apps/api/core";
import { bookmarks, bookmarkUrl, saveBookmark } from "@/features/bookmarks/library";
import {
  isPrivateBrowserView,
  parseBrowserViewState,
  useWorkspaceStore,
} from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import { devicesNative } from "@/native/devices";
import { agentsPrepareScopedDocument } from "./store/useAgentsStore";
import type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/**
 * Device jobs for the grants a desktop chat attached: shared folders (read
 * only) and the Misty browser's tabs and bookmarks. Each job names the grant
 * it runs under; a folder job never reaches outside its folder, and private
 * tabs are never listed.
 */
export const deviceAgentOperations = new Set([
  "files.list",
  "files.read",
  "files.send",
  "tabs.list",
  "tabs.open",
  "bookmarks.list",
  "bookmarks.add",
]);

const readLimit = 20_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scopedPath(job: ClaimedWorkflowNodeJob["job"]) {
  const input = record(job.input);
  const relativePath = typeof input.relativePath === "string" ? input.relativePath : "";
  if (
    input.scopeId !== job.scopeId ||
    relativePath.startsWith("/") ||
    relativePath.split(/[\\/]/).includes("..")
  )
    throw new Error("invalid_device_scope");
  return { scopeId: job.scopeId, relativePath };
}

function webAddress(value: unknown) {
  try {
    return bookmarkUrl(typeof value === "string" ? value : "");
  } catch {
    throw new Error("invalid_url");
  }
}

export async function runDeviceAgentOperation(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const input = record(job.input);
  switch (job.operation) {
    case "files.send": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      // The file goes directly to the other device over the LAN; only this
      // receipt returns to the server.
      const receipt = await devicesNative.sendFile(job.scopeId, job.input, job.config);
      return { ...receipt };
    }
    case "files.list":
      return invoke<Record<string, unknown>>("agents_list_scoped_files", {
        request: scopedPath(job),
      });
    case "files.read": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      const document = await agentsPrepareScopedDocument(
        { ...target, spaceId: job.spaceId ?? "" },
        signal,
      );
      let text = document.sections.map((section) => section.text).join("\n\n");
      const truncated = document.truncated || text.length > readLimit;
      text = text.slice(0, readLimit);
      return { name: document.displayName, mimeType: document.mimeType, text, truncated };
    }
    case "tabs.list": {
      const tabs: Array<{ id: string; title: string; url: string }> = [];
      const seen = new Set<string>();
      mapAllWorkspaceWindowViews(useWorkspaceStore.getState(), (view) => {
        if (view.surfaceId === "browser" && !isPrivateBrowserView(view) && !seen.has(view.id)) {
          seen.add(view.id);
          const url = parseBrowserViewState(view.state).url;
          if (/^https?:/i.test(url)) tabs.push({ id: view.id, title: view.title, url });
        }
        return view;
      });
      return { tabs: tabs.slice(0, 200) };
    }
    case "tabs.open": {
      const url = webAddress(input.url);
      const view = useWorkspaceStore.getState().openBrowserView({ url });
      return { opened: url, tabId: view.id };
    }
    case "bookmarks.list": {
      const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      const items = bookmarks(useWorkspaceStore.getState().bookmarks)
        .filter(
          (item) =>
            !query ||
            item.title.toLowerCase().includes(query) ||
            item.url.toLowerCase().includes(query),
        )
        .slice(0, 100)
        .map((item) => ({ id: item.id, title: item.title, url: item.url }));
      return { bookmarks: items };
    }
    case "bookmarks.add": {
      const url = webAddress(input.url);
      const title = typeof input.title === "string" ? input.title : "";
      return { bookmarkId: saveBookmark({ url, title }), url };
    }
  }
  throw new Error(`unsupported_device_operation:${job.operation}`);
}
