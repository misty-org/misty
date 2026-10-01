import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { Button, Card, NavIsland } from "@/shared/ui";
import { FileOutput, Mic, MousePointer2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AgentAvatar } from "./AgentAvatar";
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

export function AgentOverviewPanel(props: {
  profile: AgentProfile;
  access: AgentAccessState;
  conversations: GlobalAiConversation[];
  navigation: ReactNode;
  working: boolean;
  voiceBusy: boolean;
  recording: boolean;
  onTalk(): void;
  onCompanion(): void;
  onConnections(): void;
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
      <header className="flex items-center gap-3">
        <AgentAvatar agent={props.profile} large />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-cream-bright">
            {props.profile.name}
          </h2>
          <p role="status" className="mt-1 text-sm text-cream-muted">
            {status}
          </p>
        </div>
      </header>
      <NavIsland aria-label="Agent actions" className="w-full">
        <Button
          variant="toolbar"
          size="sm"
          className="flex-1"
          disabled={!props.profile.enabled || props.working || props.voiceBusy}
          onClick={props.onTalk}
          title="Dictate a message to review before sending"
        >
          <Mic className="size-4" />
          {props.recording ? "Stop recording" : "Talk"}
        </Button>
        <Button variant="toolbar" size="sm" className="flex-1" onClick={props.onCompanion}>
          <MousePointer2 className="size-4" />
          Companion
        </Button>
      </NavIsland>
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
              className="h-auto min-h-9 gap-2 whitespace-normal text-left"
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
