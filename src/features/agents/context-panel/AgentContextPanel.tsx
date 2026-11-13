import { RotateCw } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { useWorkspaceViewId } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import { ErrorState, SidePanelHeader, Text } from "@/shared/ui";
import type { ContextPanelSurface } from "./contextPanelStore";
import { FilesBreadcrumbs } from "./files/FilesBreadcrumbs";
import { FilesPanel } from "./files/FilesPanel";
import { mistyEngine } from "../engines/enginesApi";
import { worksInFolder } from "../shared-folders/agentFolder";
import { AgentFolderPicker, FolderPicker, useProjectFolder } from "./FolderPicker";
import { ChangesPanel } from "./git/ChangesPanel";
import { LaunchScriptButton } from "./launch-script/LaunchScriptActions";
import { OpenInMenu } from "./open-app/OpenInMenu";
import { ContextPanelSkeleton } from "./PanelSkeletons";
import { StepsPanel } from "../activity/StepsPanel";
import { WorktreesButton } from "./worktree/WorktreesButton";
import { terminalChatKey } from "./terminal/terminalStore";
import "./codeViews.css";

const TerminalPanel = lazy(() => import("./terminal/TerminalPanel"));
const PreviewPanel = lazy(() => import("../preview/PreviewPanel"));

/**
 * What the chat's side panel shows for a context view: the Space's linked project folder as
 * files, as Git changes, or as a terminal, the run's steps, or the person's running app in the
 * preview, which needs no folder. Agents on outside engines work in the same folder, so this is
 * where their work shows. A folder's own tools sit at the end of the panel's header row; Files puts
 * its path there too, starting with the folder as a menu that switches to another.
 */
export function AgentContextPanel(props: {
  tab: ContextPanelSurface;
  conversationId: string;
  agent: AgentProfile;
}) {
  const { folder, loaded, failed, retry } = useProjectFolder(props.agent);
  const chat = terminalChatKey(props.conversationId, useWorkspaceViewId());
  if (props.tab === "steps") return <StepsPanel conversationId={props.conversationId} />;
  return (
    <>
      {folder && props.tab !== "preview" ? (
        <SidePanelHeader>
          {props.tab === "files" ? (
            <FilesBreadcrumbs
              folder={folder}
              picker={
                worksInFolder(props.agent) ? (
                  <AgentFolderPicker agent={props.agent} />
                ) : (
                  <FolderPicker />
                )
              }
            />
          ) : null}
          <div className="flex flex-none items-center gap-0.5" data-side-panel-trailing="">
            <WorktreesButton folder={folder} />
            <LaunchScriptButton chat={chat} folder={folder} />
            <OpenInMenu folder={folder} />
          </div>
        </SidePanelHeader>
      ) : null}
      {props.tab === "preview" ? (
        <Suspense fallback={<ContextPanelSkeleton tab="preview" />}>
          <PreviewPanel conversationId={props.conversationId} />
        </Suspense>
      ) : failed ? (
        <ErrorState
          title="Couldn't read the Space's folders"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", icon: RotateCw, onClick: retry }}
        />
      ) : !loaded ? (
        // The Space's folders are on their way: the view as it will be, tools and all.
        <ContextPanelSkeleton tab={props.tab} />
      ) : !folder ? (
        props.agent.engine && props.agent.engine !== mistyEngine ? (
          <FolderMissing line="You'll choose its folder when you send the first message.">
            <AgentFolderPicker agent={props.agent} />
          </FolderMissing>
        ) : (
          <FolderMissing line="Link a project folder to this Space to see its files here.">
            <FolderPicker />
          </FolderMissing>
        )
      ) : props.tab === "files" ? (
        <FilesPanel folder={folder} />
      ) : props.tab === "changes" ? (
        <ChangesPanel folder={folder} />
      ) : (
        <Suspense fallback={<ContextPanelSkeleton tab="terminal" tools={false} />}>
          <TerminalPanel chat={chat} folder={folder} />
        </Suspense>
      )}
    </>
  );
}

/** A folder view with no folder yet: centered in the panel, what's missing and the way to link one. */
function FolderMissing(props: { line: string; children: ReactNode }) {
  return (
    <Text
      as="div"
      bare
      size="meta"
      tone="muted"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="m-0 max-w-65">{props.line}</p>
      {props.children}
    </Text>
  );
}
