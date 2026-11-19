import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, notify, Text } from "@/shared/ui";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { AgentWorkspaceConversation } from "../conversations/view/AgentWorkspaceConversation";
import { newLocalConversation } from "../conversations/state/localConversation";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useAgentAccountId } from "../personal/agentAccount";
import { homeSpaceOf } from "../personal/agentHomeSpace";
import { defaultAgentOf, usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { openAgentsHub } from "../hub/agentsHubStore";
import {
  forgetVideoTurn,
  onVideoTurns,
  videoTurnBefore,
  videoTurnsFor,
} from "../tools/space/videoTurns";

/** Each item's chat in the Agent tab, kept while Misty runs, so reopening the editor finds it. */
const itemChats = new Map<string, string>();

/** Takes back everything a turn changed in a project: the project as it was before the turn. */
export async function revertVideoTurn(runId: string, itemId: string): Promise<void> {
  const kept = videoTurnBefore(runId).find((entry) => entry.itemId === itemId);
  const gateway = spacesGateway.maybe();
  if (!kept || !gateway) return;
  const video = await gateway.openLibraryVideo(kept.spaceId, itemId);
  try {
    const document = structuredClone(kept.document);
    const project = document.project as { metadata?: { updatedAt?: string } } | null;
    // The old project as the newest change, so it wins in every open editor.
    if (project?.metadata) project.metadata.updatedAt = new Date().toISOString();
    await video.keep(document);
  } finally {
    video.close();
  }
  forgetVideoTurn(runId);
}

/**
 * Whether the person's agent can work on a video or image in this Space: an agent's Space tools
 * act in its home Space, so the Agent tab shows only where they would reach it.
 */
export function useMediaAgent(spaceId: string) {
  const account = useAgentAccountId();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const agent = useMemo(() => defaultAgentOf(agents), [agents]);
  return agent && homeSpaceOf(account, agent) === spaceId ? { agent, account } : null;
}

/**
 * A chat with the person's agent about one Media item, of the item's own: opened again, the
 * editor finds the same chat. Nothing shows where the agent's tools can't reach the item.
 */
function MediaAgentChat(props: {
  spaceId: string;
  itemId: string;
  /** Names the chat and starts its first message: "Video: Trip", "About the video “Trip” …". */
  kind: "video" | "image";
  name: string;
  children?: ReactNode;
}) {
  const { spaceId, itemId, kind, name } = props;
  const working = useMediaAgent(spaceId);
  const [conversationId, setConversationId] = useState(() => itemChats.get(itemId));
  useEffect(() => {
    if (conversationId || !working) return;
    const title = `${kind === "video" ? "Video" : "Image"}: ${name}`;
    const conversation = newLocalConversation(title, spaceId, working.agent.id);
    useMistyStore.setState((state) => ({
      conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)],
    }));
    itemChats.set(itemId, conversation.id);
    setConversationId(conversation.id);
  }, [conversationId, itemId, kind, name, spaceId, working]);
  if (!working || !conversationId) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {props.children}
      <AgentWorkspaceConversation
        key={conversationId}
        agent={working.agent}
        conversationId={conversationId}
        spaceId={spaceId}
        accountId={working.account}
        initialDraft={`About the ${kind} “${name}” (Media item ${itemId}): `}
        onCreate={() => openAgentsHub("agents")}
      />
    </div>
  );
}

/** The photo editor's Agent tab: a chat with the person's agent about the image open in it. */
export function ImageAgentPanel(props: { spaceId: string; itemId: string; name: string }) {
  return <MediaAgentChat {...props} kind="image" />;
}

/**
 * The video editor's Agent tab: a chat with the person's agent about the project open in the
 * editor, and each of the agent's turns that changed it, which can be taken back whole.
 */
export function VideoAgentPanel(props: { spaceId: string; itemId: string; name: string }) {
  const { itemId } = props;
  const turns = useSyncExternalStore(
    onVideoTurns,
    () => JSON.stringify(videoTurnsFor(itemId)),
    () => "[]",
  );
  const [reverting, setReverting] = useState<string | null>(null);
  const list = JSON.parse(turns) as Array<{ runId: string; at: number }>;
  const revert = async (runId: string) => {
    setReverting(runId);
    try {
      await revertVideoTurn(runId, itemId);
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "The change could not be taken back.",
        tone: "error",
      });
    } finally {
      setReverting(null);
    }
  };
  return (
    <MediaAgentChat {...props} kind="video">
      {list.length > 0 && (
        <ul aria-label="Changes your agent made" className="grid gap-1 px-2 pt-2">
          {list.map((turn) => (
            <li key={turn.runId} className="flex items-center gap-2">
              <Text size="control" tone="muted" className="min-w-0 flex-1">
                Changed at{" "}
                {new Date(turn.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </Text>
              <Button
                size="sm"
                variant="secondary"
                disabled={reverting !== null}
                onClick={() => void revert(turn.runId)}
              >
                Revert
              </Button>
            </li>
          ))}
        </ul>
      )}
    </MediaAgentChat>
  );
}
