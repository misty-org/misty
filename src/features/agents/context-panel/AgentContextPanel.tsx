import { lazy, Suspense } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { Skeleton } from "@/shared/ui";
import { ChangesPanel } from "./ChangesPanel";
import type { ContextPanelTab } from "./contextPanelStore";
import { FilesPanel } from "./FilesPanel";
import { FolderPicker, useProjectFolder } from "./FolderPicker";
import "./contextPanel.css";

const TerminalPanel = lazy(() => import("./TerminalPanel"));

const titles: Record<ContextPanelTab, string> = {
  files: "Files",
  changes: "Changes",
  terminal: "Terminal",
};

/**
 * The panel beside a chat: the Space's linked project folder as files, as Git changes, or as a
 * terminal. Agents on outside engines work in the same folder, so this is where their work shows.
 */
export function AgentContextPanel(props: {
  tab: ContextPanelTab;
  conversationId: string;
  agent: AgentProfile;
}) {
  const { folder, loaded } = useProjectFolder();
  return (
    <>
      <header className="context-head">
        <h2 className="text-sm font-medium text-cream">{titles[props.tab]}</h2>
        <FolderPicker />
      </header>
      {!loaded ? (
        <div className="grid gap-2 p-3" aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      ) : !folder ? (
        <p className="p-4 text-sm text-cream-muted">
          Link a project folder to this Space to see its files here.
        </p>
      ) : props.tab === "files" ? (
        <FilesPanel folder={folder} />
      ) : props.tab === "changes" ? (
        <ChangesPanel folder={folder} />
      ) : (
        <Suspense fallback={<div className="min-h-0 flex-1" />}>
          <TerminalPanel key={folder} folder={folder} />
        </Suspense>
      )}
    </>
  );
}
