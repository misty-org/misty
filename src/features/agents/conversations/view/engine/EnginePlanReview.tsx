import { useState } from "react";
import type { EnginePlanReview as PlanReview } from "../../../runs/invocations/invocation_types";
import { MistyMarkdown } from "../../../runs/markdown/MistyMarkdown";
import { setPermissionMode } from "../../../plans/permission_mode";
import { useCollaborationStore } from "../../../plans/store";
import { Button, Surface, Text, Textarea } from "@misty/ui";
import { respondToPlan, type PlanDecision } from "./engine_api";

const PLAN_APPROVED_PROMPT = "The plan is approved. Go ahead and carry it out.";

const settledLabel: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  deferred: "Not now",
  expired: "No longer current",
  superseded: "Replaced by a newer plan",
  cancelled: "Cancelled",
};

export function EnginePlanReview(props: {
  plan: PlanReview;
  draft?: boolean;
  conversationId?: string;
  onSend?: (prompt: string) => void;
}) {
  const { plan } = props;
  const [status, setStatus] = useState(plan.status);
  const [changing, setChanging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open =
    !props.draft && plan.complete && (status === "awaiting_review" || status === "deferred");

  const decide = async (decision: PlanDecision) => {
    setBusy(true);
    setError("");
    try {
      const decided = await respondToPlan(
        plan.planId,
        plan.revision,
        decision,
        decision === "request_changes" ? feedback.trim() : undefined,
      );
      setStatus(decided.review.status);
      if (decision === "approve") {
        await setPermissionMode(props.conversationId, "auto");
        await useCollaborationStore.getState().setMode(props.conversationId, "act");
        if (decided.continueInAuto) props.onSend?.(PLAN_APPROVED_PROMPT);
      } else if (decision === "request_changes" && !decided.native && feedback.trim()) {
        props.onSend?.(feedback.trim());
      }
      setChanging(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface
      as="section"
      tone="faint"
      radius="xl"
      className="grid gap-3 px-4 py-3.5"
      aria-label="Plan"
    >
      <header className="flex items-center justify-between gap-2">
        <Text size="control" weight="medium" tone="default">
          {plan.title || "Plan"}
        </Text>
        {props.draft ? (
          <Text bare size="caption" tone="muted" className="shrink-0">
            Writing
          </Text>
        ) : null}
        {!props.draft && !open ? (
          <Text bare size="caption" tone="muted" className="shrink-0">
            {settledLabel[status] ?? status}
          </Text>
        ) : null}
      </header>
      <div className="max-h-105 overflow-auto">
        <MistyMarkdown>{plan.content}</MistyMarkdown>
      </div>
      {open ? (
        changing ? (
          <div className="grid gap-2">
            <Textarea
              aria-label="What to change"
              placeholder="What should change"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy || !feedback.trim()}
                onClick={() => void decide("request_changes")}
              >
                Send changes
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setChanging(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void decide("approve")}>
              Approve and run in Auto
            </Button>
            <Button disabled={busy} onClick={() => setChanging(true)}>
              Request changes
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => void decide("defer")}>
              Not now
            </Button>
          </div>
        )
      ) : null}
      {error ? (
        <Text wrap size="meta" tone="danger" className="m-0" role="alert">
          {error}
        </Text>
      ) : null}
    </Surface>
  );
}
