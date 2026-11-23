import { RotateCw } from "lucide-react";
import { type ReactNode } from "react";
import { useWorkspaceViewId } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import { ErrorState, SidePanelHeader, Text, lazyTool, ToolSuspense } from "@misty/ui";
import type { ContextPanelSurface } from "./context_panel_store";
import { FilesBreadcrumbs } from "./files/FilesBreadcrumbs";
import { FilesPanel } from "./files/FilesPanel";
import { useChatFolder } from "../shared-folders/chat_folder";
import { ChatFolderPicker } from "./ChatFolderPicker";
import { ChangesPanel } from "./git/ChangesPanel";
import { LaunchScriptButton } from "./launch-script/LaunchScriptActions";
import { OpenInMenu } from "./open-app/OpenInMenu";
import { ContextPanelSkeleton } from "./PanelSkeletons";
import { StepsPanel } from "../activity/StepsPanel";
import { WorktreesButton } from "./worktree/WorktreesButton";
import { terminalChatKey } from "./terminal/terminal_store";
import "./code_views.css";

const TerminalPanel = lazyTool(() => import("./terminal/TerminalPanel"));

export function AgentContextPanel(props: {
  tab: ContextPanelSurface;
  conversationId: string;
  agent: AgentProfile;
}) {
  const { folder, kind, loaded, failed, retry } = useChatFolder(props.conversationId);
  const scratch = kind === "scratch" || kind === "thread";
  const chat = terminalChatKey(props.conversationId, useWorkspaceViewId());
  if (props.tab === "steps") return <StepsPanel conversationId={props.conversationId} />;
  return (
    <>
      {folder ? (
        <SidePanelHeader>
          {props.tab === "files" ? (
            <FilesBreadcrumbs
              folder={folder}
              picker={
                scratch ? (
                  <Text size="control" tone="bright" className="px-1">
                    {kind === "thread"
                      ? (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder)
                      : "Scratch"}
                  </Text>
                ) : (
                  <ChatFolderPicker conversationId={props.conversationId} />
                )
              }
            />
          ) : null}
          <div className="flex flex-none items-center gap-0.5" data-side-panel-trailing="">
            <WorktreesButton folder={folder} conversationId={props.conversationId} />
            <LaunchScriptButton chat={chat} folder={folder} />
            <OpenInMenu folder={folder} />
          </div>
        </SidePanelHeader>
      ) : null}
      {failed ? (
        <ErrorState
          title="Couldn't read the chat's folder"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", icon: RotateCw, onClick: retry }}
        />
      ) : !loaded ? (
        <ContextPanelSkeleton tab={props.tab} />
      ) : !folder ? (
        <FolderMissing line="This chat gets its own folder when it starts." />
      ) : props.tab === "files" ? (
        <FilesPanel folder={folder} />
      ) : props.tab === "changes" ? (
        <ChangesPanel folder={folder} />
      ) : (
        <ToolSuspense tool="terminal">
          <TerminalPanel chat={chat} folder={folder} />
        </ToolSuspense>
      )}
    </>
  );
}

function FolderMissing(props: { line: string; children?: ReactNode }) {
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
