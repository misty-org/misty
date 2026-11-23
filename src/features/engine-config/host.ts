import { createElement, type ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

interface EngineConfigHost {
  useLinkedFolders(): { folders: string[]; picked?: string };
  Markdown: ComponentType<{ children: string }>;
  watchRunEvents(listener: (runId: string, event: unknown) => void): () => void;
}

export const engineConfigHost = createPort<EngineConfigHost>("engine settings' host");

const noFolders = { folders: [] as string[] };

export function useLinkedFolders(): { folders: string[]; picked?: string } {
  const host = engineConfigHost.maybe();
  return host ? host.useLinkedFolders() : noFolders;
}

export function HostMarkdown({ children }: { children: string }) {
  const Markdown = engineConfigHost.maybe()?.Markdown;
  return Markdown
    ? createElement(Markdown, null, children)
    : createElement("pre", { className: "whitespace-pre-wrap" }, children);
}

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
