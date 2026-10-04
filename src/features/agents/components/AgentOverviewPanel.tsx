import type { AgentProfile } from "@/shared/schemas";
import { Card } from "@/shared/ui";
import { useState, type ReactNode } from "react";
import { AgentAccess, type AgentAccessState } from "./AgentAccess";
import { MistyDashboard, type AgentActivityState } from "./MistyDashboard";

/**
 * Details beside the conversation. The workspace sidebar owns the agent's identity,
 * history and settings, and the composer owns dictation, so none repeat here.
 */
export function AgentOverviewPanel(props: {
  profile: AgentProfile;
  access: AgentAccessState;
  navigation?: ReactNode;
  working: boolean;
  recording: boolean;
  onCompanion(): void;
  onConnections(source?: "apps"): void;
}) {
  const [activityState, setActivityState] = useState<AgentActivityState>("loading");
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
    </Card>
  );
}
