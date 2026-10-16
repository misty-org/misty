import { invoke } from "@tauri-apps/api/core";
import { uploadLibraryBlob } from "@/api/spaces/library-upload";
import { bookmarks, bookmarkUrl, saveBookmark } from "@/features/bookmarks/library";
import {
  isPrivateBrowserView,
  parseBrowserViewState,
  useWorkspaceStore,
} from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import { devicesNative } from "@/native/devices";
import { agentsPrepareScopedDocument } from "./store/useAgentsStore";
import { readablePage } from "./webFetchText";
import type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/**
 * Device jobs for the grants a desktop chat attached: shared folders (read
 * only) and the Misty browser's tabs and bookmarks. Each job names the grant
 * it runs under; a folder job never reaches outside its folder, and private
 * tabs are never listed.
 */
export const deviceAgentOperations = new Set([
  "folder.list",
  "folder.read",
  "folder.send",
  "browser.tab.list",
  "browser.tab.open",
  "bookmark.list",
  "bookmark.add",
  "web.fetch",
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
    case "folder.send": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      if (!job.spaceId) throw new Error("no_space");
      // The file is read natively under the job's grant and arrives in the
      // conversation's Space Library as a new item.
      const bytes = await devicesNative.readSharedFile(job.scopeId, job.input, job.config);
      const name = target.relativePath.split(/[\\/]/).filter(Boolean).pop() || "file";
      const uploaded = await uploadLibraryBlob(job.spaceId, new Blob([bytes]), name);
      return { name, size: bytes.byteLength, libraryItemId: uploaded.item?.id ?? null };
    }
    case "folder.list":
      return invoke<Record<string, unknown>>("agents_list_scoped_files", {
        request: scopedPath(job),
      });
    case "folder.read": {
      const target = scopedPath(job);
      if (!target.relativePath) throw new Error("invalid_device_scope");
      const document = await agentsPrepareScopedDocument(target, signal);
      let text = document.sections.map((section) => section.text).join("\n\n");
      const truncated = document.truncated || text.length > readLimit;
      text = text.slice(0, readLimit);
      return { name: document.displayName, mimeType: document.mimeType, text, truncated };
    }
    case "browser.tab.list": {
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
    case "browser.tab.open": {
      const url = webAddress(input.url);
      const view = useWorkspaceStore.getState().openBrowserView({ url });
      return { opened: url, tabId: view.id };
    }
    case "bookmark.list": {
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
    case "web.fetch": {
      // Fetched natively without cookies; the network checks live in web_fetch.rs.
      const page = await invoke<{
        finalUrl: string;
        status: number;
        contentType: string;
        body: string;
        truncated: boolean;
      }>("agents_web_fetch", { url: webAddress(input.url) });
      const question = typeof input.question === "string" ? input.question : "";
      const readable = readablePage(page.body, page.contentType, question);
      return {
        url: page.finalUrl,
        status: page.status,
        title: readable.title,
        text: readable.text,
        truncated: readable.truncated || page.truncated,
      };
    }
    case "bookmark.add": {
      const url = webAddress(input.url);
      const title = typeof input.title === "string" ? input.title : "";
      return { bookmarkId: saveBookmark({ url, title }), url };
    }
  }
  throw new Error(`unsupported_device_operation:${job.operation}`);
}
