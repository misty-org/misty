import type { GlobalAiConversation } from "@/features/global-search/types";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { Spinner } from "@/shared/ui";
import type { AgentDetailsSection } from "./AgentDetailsPanel";
import {
  AgentFilesPanel,
  AgentSourcesPanel,
  conversationFiles,
  conversationSources,
} from "./AgentPanelContents";
import { AgentTaskPanel, conversationRuns } from "./AgentTaskPanel";

const issueStates = new Set(["failed", "completed_with_errors", "awaiting_intervention"]);

/** A chip's "needs a look" mark: an exclamation point, named for screen readers. */
const issue = (
  <>
    <span className="agent-details-issue" aria-hidden="true">
      !
    </span>
    <span className="sr-only">Needs a look</span>
  </>
);

/**
 * The Details sections for the open conversation, in chip order. Each is about this
 * conversation only; what every agent can reach lives on Integrations.
 */
export function agentDetailsSections({
  activity,
  conversation,
  working,
  deviceName,
}: {
  activity: { entries: MistyActivityEntry[]; loading: boolean };
  conversation?: GlobalAiConversation;
  working: boolean;
  deviceName?: string;
}): AgentDetailsSection[] {
  const latest = conversation ? conversationRuns(activity.entries, conversation.id)[0] : undefined;
  const sources = conversationSources(conversation).length;
  const files = conversationFiles(conversation);
  const fileCount = files.attached.length + files.made.length;
  return [
    {
      id: "task",
      label: "Task",
      badge: working ? (
        <Spinner size="sm" label="Working" />
      ) : latest && issueStates.has(latest.state) ? (
        issue
      ) : undefined,
      content: (
        <AgentTaskPanel
          activity={activity}
          conversation={conversation}
          working={working}
          deviceName={deviceName}
        />
      ),
    },
    {
      id: "sources",
      label: "Sources",
      badge: sources || undefined,
      content: <AgentSourcesPanel conversation={conversation} />,
    },
    {
      id: "files",
      label: "Files",
      badge: files.failed.length ? issue : fileCount || undefined,
      content: <AgentFilesPanel conversation={conversation} />,
    },
  ];
}
