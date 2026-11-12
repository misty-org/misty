import { createElement, type ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

/**
 * What engine settings need from the agents that use the engines, filled in once by the app
 * (`app/featureSeams.ts`). Agents sit above engine settings, so engine settings never import them.
 */
export interface EngineConfigHost {
  /** This window's Space's linked folders and the one picked, read on first use. */
  useLinkedFolders(): { folders: string[]; picked?: string };
  /** Markdown drawn the way chats draw it. */
  Markdown: ComponentType<{ children: string }>;
  /** Every run's events as they arrive; returns a function that stops listening. */
  watchRunEvents(listener: (runId: string, event: unknown) => void): () => void;
}

export const engineConfigHost = createPort<EngineConfigHost>("engine settings' host");

const noFolders = { folders: [] as string[] };

/** The Space's linked folders, or none where no app filled the host (a preview, a test). */
export function useLinkedFolders(): { folders: string[]; picked?: string } {
  const host = engineConfigHost.maybe();
  return host ? host.useLinkedFolders() : noFolders;
}

/** Markdown as chats draw it, or the plain text where no app filled the host. */
export function HostMarkdown({ children }: { children: string }) {
  const Markdown = engineConfigHost.maybe()?.Markdown;
  return Markdown
    ? createElement(Markdown, null, children)
    : createElement("pre", { className: "whitespace-pre-wrap" }, children);
}

/** A folder's own name, for a row that has no room for its whole path. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
