import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { agentMentionsApi, type AgentMentionStep } from "@/api/spaces/agent-mentions";
import { StatusRow, StatusTable, type StatusState } from "@/features/agents";
import { Button, IconButton, Skeleton } from "@/shared/ui";
import { useChatSidePanel } from "../store/chatSidePanelStore";

const states: Record<string, { state: StatusState; verb: string }> = {
  completed: { state: "done", verb: "Done" },
  completed_with_errors: { state: "failed", verb: "Done with errors" },
  failed: { state: "failed", verb: "Failed" },
  canceled: { state: "stopped", verb: "Stopped" },
  rejected: { state: "stopped", verb: "Declined" },
  awaiting_approval: { state: "waiting", verb: "Waiting" },
  running: { state: "running", verb: "Working" },
  cooldown: { state: "running", verb: "Working" },
  queued: { state: "next", verb: "Queued" },
};

/** Run step names are internal ("model:1", "mcp:catalog"); say them plainly. */
export function stepLabel(name: string) {
  const [kind, detail = ""] = name.split(":");
  if (kind === "model") return detail && detail !== "1" ? `Thinking (step ${detail})` : "Thinking";
  if (kind === "mcp" && detail === "catalog") return "Looking up available tools";
  const text = name.replace(/[:._-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Step";
}

/**
 * On an agent's reply to your mention: how it got there. Only the person who asked sees this
 * button; the steps are outcomes without inputs, so private data from the agent's apps stays out.
 */
export function AgentTranscriptButton({ requestId }: { requestId: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1 -ml-2"
      onClick={() => useChatSidePanel.getState().openTranscript(requestId)}
    >
      Show transcript
    </Button>
  );
}

/** The transcript as a floating card over the chat's right edge, so the channel stays in view. */
export function AgentTranscriptCard({ requestId }: { requestId: string }) {
  const [loaded, setLoaded] = useState<{ id: string; steps: AgentMentionStep[] } | null>(null);
  const [failedId, setFailedId] = useState("");
  const close = () => useChatSidePanel.getState().closeTranscript();
  useEffect(() => {
    const controller = new AbortController();
    agentMentionsApi
      .transcript(requestId, controller.signal)
      .then((steps) => setLoaded({ id: requestId, steps }))
      .catch(() => !controller.signal.aborted && setFailedId(requestId));
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      controller.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [requestId]);
  const steps = loaded?.id === requestId ? loaded.steps : null;
  return (
    <aside
      aria-label="Transcript"
      className="absolute bottom-20 right-3 top-14 z-20 flex w-[min(380px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card"
    >
      <header className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2">
        <h2 className="m-0 min-w-0 flex-1 text-sm font-medium text-cream-bright">Transcript</h2>
        <IconButton label="Close transcript" size="xs" onClick={close}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="m-0 mb-3 text-xs text-cream-muted">
          What the agent did to answer you. Only you can see this.
        </p>
        {failedId === requestId ? (
          <p role="alert" className="text-sm">
            The transcript couldn&apos;t be loaded. Close this and try again.
          </p>
        ) : steps === null ? (
          <Skeleton className="h-24 w-full" />
        ) : steps.length === 0 ? (
          <p className="text-sm">The agent answered without any recorded steps.</p>
        ) : (
          <StatusTable label="Transcript">
            {steps.map((step, index) => {
              const look = states[step.state] ?? states.running;
              return (
                <StatusRow
                  key={`${step.name}-${index}`}
                  state={look.state}
                  verb={look.verb}
                  meta={step.error}
                >
                  {stepLabel(step.name)}
                </StatusRow>
              );
            })}
          </StatusTable>
        )}
      </div>
    </aside>
  );
}
