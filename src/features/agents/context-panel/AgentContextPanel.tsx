import { RotateCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { useWorkspaceViewId } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import { ErrorState, Skeleton } from "@/shared/ui";
import type { ContextPanelTab } from "./contextPanelStore";
import { FilesPanel } from "./files/FilesPanel";
import { FolderPicker, useProjectFolder } from "./FolderPicker";
import { ChangesPanel } from "./git/ChangesPanel";
import { LaunchScriptButton } from "./launch-script/LaunchScriptActions";
import { OpenInMenu } from "./open-app/OpenInMenu";
import { SessionPanel } from "./SessionPanel";
import { StepsPanel } from "../activity/StepsPanel";
import { WorktreesButton } from "./worktree/WorktreesButton";
import { terminalChatKey } from "./terminal/terminalStore";
import "./contextPanel.css";

const TerminalPanel = lazy(() => import("./terminal/TerminalPanel"));
const PreviewPanel = lazy(() => import("../preview/PreviewPanel"));

/** What a panel shows while its code or its first read is on the way, never a blank box. */
const panelSkeleton = (
  <div className="grid gap-2 p-3" aria-hidden="true">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-4 w-56" />
  </div>
);

/**
 * The panel beside a chat: the chat's session at a glance, or the Space's linked project folder
 * as files, as Git changes, or as a terminal; the folder is chosen in the session card. Agents on
 * outside engines work in the same folder, so this is where their work shows.
 * The preview tab shows the person's running app instead and needs no folder.
 */
export function AgentContextPanel(props: {
  tab: ContextPanelTab;
  conversationId: string;
  agent: AgentProfile;
}) {
  const { folder, loaded, failed, retry } = useProjectFolder();
  const chat = terminalChatKey(props.conversationId, useWorkspaceViewId());
  if (props.tab === "session") {
    return <SessionPanel conversationId={props.conversationId} agent={props.agent} />;
  }
  if (props.tab === "steps") return <StepsPanel conversationId={props.conversationId} />;
  // No title bar: the rail already says which panel this is. A panel's own controls are its first row.
  return (
    <>
      {folder && props.tab !== "preview" ? (
        <div className="context-tools">
          <WorktreesButton folder={folder} />
          <LaunchScriptButton chat={chat} folder={folder} />
          <OpenInMenu folder={folder} />
        </div>
      ) : null}
      {props.tab === "preview" ? (
        <Suspense fallback={panelSkeleton}>
          <PreviewPanel />
        </Suspense>
      ) : failed ? (
        <ErrorState
          title="Couldn't read the Space's folders"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", icon: RotateCw, onClick: retry }}
        />
      ) : !loaded ? (
        panelSkeleton
      ) : !folder ? (
        <div className="context-empty">
          <p>Link a project folder to this Space to see its files here.</p>
          <FolderPicker />
        </div>
      ) : props.tab === "files" ? (
        <FilesPanel folder={folder} />
      ) : props.tab === "changes" ? (
        <ChangesPanel folder={folder} />
      ) : (
        <Suspense fallback={panelSkeleton}>
          <TerminalPanel chat={chat} folder={folder} />
        </Suspense>
      )}
    </>
  );
}
