import { lazy, Suspense } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { Skeleton } from "@/shared/ui";
import type { ContextPanelTab } from "./contextPanelStore";
import { FilesPanel } from "./files/FilesPanel";
import { FolderPicker, useProjectFolder } from "./FolderPicker";
import { ChangesPanel } from "./git/ChangesPanel";
import { LaunchScriptButton } from "./launch-script/LaunchScriptActions";
import { OpenInMenu } from "./open-app/OpenInMenu";
import { SessionPanel } from "./SessionPanel";
import { StepsPanel } from "../activity/StepsPanel";
import { WorktreesButton } from "./worktree/WorktreesButton";
import "./contextPanel.css";

const TerminalPanel = lazy(() => import("./terminal/TerminalPanel"));
const PreviewPanel = lazy(() => import("../preview/PreviewPanel"));
const BrowserPanel = lazy(() => import("./BrowserPanel"));

/**
 * The panel beside a chat: the chat's session at a glance, or the Space's linked project folder
 * as files, as Git changes, or as a terminal; the folder is chosen in the session card. Agents on
 * outside engines work in the same folder, so this is where their work shows.
 * The preview tab shows the person's running app instead, and the browser tab a plain browser for
 * the person; neither needs a folder.
 */
export function AgentContextPanel(props: {
  tab: ContextPanelTab;
  conversationId: string;
  agent: AgentProfile;
}) {
  const { folder, loaded } = useProjectFolder();
  if (props.tab === "session") {
    return <SessionPanel conversationId={props.conversationId} agent={props.agent} />;
  }
  if (props.tab === "steps") return <StepsPanel conversationId={props.conversationId} />;
  // No title bar: the rail already says which panel this is. A panel's own controls are its first row.
  return (
    <>
      {folder && props.tab !== "preview" && props.tab !== "browser" ? (
        <div className="context-tools">
          <WorktreesButton folder={folder} />
          <LaunchScriptButton folder={folder} />
          <OpenInMenu folder={folder} />
        </div>
      ) : null}
      {props.tab === "browser" ? (
        <Suspense fallback={<div className="min-h-0 flex-1" />}>
          <BrowserPanel />
        </Suspense>
      ) : props.tab === "preview" ? (
        <Suspense fallback={<div className="min-h-0 flex-1" />}>
          <PreviewPanel />
        </Suspense>
      ) : !loaded ? (
        <div className="grid gap-2 p-3" aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
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
        <Suspense fallback={<div className="min-h-0 flex-1" />}>
          <TerminalPanel folder={folder} />
        </Suspense>
      )}
    </>
  );
}
