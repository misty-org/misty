import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { Button, Card } from "@/shared/ui";
import { FileOutput } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AgentAccess, type AgentAccessState } from "./AgentAccess";
import { MistyDashboard, type AgentActivityState } from "./MistyDashboard";

/** Only explicit completed action results are outputs; citations are source material. */
export function agentOutputs(conversations: GlobalAiConversation[]) {
  const seen = new Set<string>();
  return [...conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((conversation) =>
      [...conversation.messages].reverse().flatMap((message) => {
        const action = message.action;
        const href = action?.resultHref;
        if (
          message.role !== "assistant" ||
          action?.state !== "completed" ||
          !href ||
          !/^\/(spaces|files)\//.test(href) ||
          /[\\\s]/.test(href) ||
          [...href].some((c) => c.charCodeAt(0) < 32) ||
          /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(href.split(/[?#]/)[0]) ||
          seen.has(href)
        )
          return [];
        seen.add(href);
        return [{ href, title: action.title || conversation.title || "Open result" }];
      }),
    );
}

/**
 * Details beside the conversation. The workspace sidebar owns the agent's identity,
 * history and settings, and the composer owns dictation, so none repeat here.
 */
export function AgentOverviewPanel(props: {
  profile: AgentProfile;
  access: AgentAccessState;
  conversations: GlobalAiConversation[];
  navigation?: ReactNode;
  working: boolean;
  recording: boolean;
  onCompanion(): void;
  onConnections(source?: "apps"): void;
  onOpenResult(href: string): void;
}) {
  const [activityState, setActivityState] = useState<AgentActivityState>("loading");
  const outputs = agentOutputs(props.conversations);
  const [allOutputs, setAllOutputs] = useState(false);
  const status = !props.profile.enabled
    ? "Disabled"
    : props.recording
      ? "Listening…"
      : activityState === "needs_input"
        ? "Needs your input"
        : props.working || activityState === "working"
          ? "Working…"
          : activityState === "waiting_for_device"
            ? "Waiting for device"
            : activityState === "queued"
              ? "Queued"
              : activityState === "loading"
                ? "Loading activity…"
                : activityState === "unavailable"
                  ? "Activity unavailable"
                  : "Ready";
  return (
    <Card className="gap-5 p-5" aria-label="Agent overview">
      <section aria-label="Status" className="grid gap-1">
        <h3 className="text-xs font-medium text-cream-muted">Status</h3>
        <p role="status" className="text-sm">
          {status}
        </p>
      </section>
      {props.navigation}
      <AgentAccess
        access={props.access}
        onConnections={props.onConnections}
        onCompanion={props.onCompanion}
        compact
      />
      <section aria-label="Recent activity" className="grid gap-2">
        <h3 className="text-xs font-medium text-cream-muted">Recent activity</h3>
        <MistyDashboard
          agentId={props.profile.id}
          limit={3}
          onActivityStateChange={setActivityState}
        />
      </section>
      {outputs.length > 0 && (
        <section aria-label="Outputs" className="grid gap-2">
          <h3 className="text-xs font-medium text-cream-muted">Outputs</h3>
          {(allOutputs ? outputs : outputs.slice(0, 3)).map((output) => (
            <Button
              variant="ghost"
              justify="start"
              className="-mx-2 h-auto min-h-9 gap-3 whitespace-normal px-2 text-left"
              key={output.href}
              onClick={() => props.onOpenResult(output.href)}
            >
              <FileOutput className="size-4 shrink-0 text-cream-muted" />
              <span className="min-w-0 break-words">{output.title}</span>
            </Button>
          ))}
          {outputs.length > 3 && (
            <Button variant="ghost" size="sm" onClick={() => setAllOutputs(!allOutputs)}>
              {allOutputs ? "Show fewer outputs" : "View all outputs"}
            </Button>
          )}
        </section>
      )}
    </Card>
  );
}
