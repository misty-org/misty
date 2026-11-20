import { useEffect, useRef, useState } from "react";
import { BrandIcon, Button, useNotice } from "@misty/ui";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";
import { appsApi, type AppRequest, type AppRequestDecision } from "./api";
import { ApprovalActions } from "./ApprovalActions";
import { useNow } from "@/shared/hooks/useNow";

function stateLabel(request: AppRequest, expired: boolean) {
  if (expired) return "Expired";
  switch (request.state) {
    case "connected":
      return "Connected";
    case "approved":
      return "Accepted";
    case "used":
      return "Accepted and done";
    case "declined":
      return request.kind === "connect" ? "Not connected" : "Denied";
    default:
      return "Expired";
  }
}

/**
 * In-chat card for something the agent needs: approve one action in a connected app.
 * `onResolved` hears every answer, so the conversation can continue.
 */
export function AppRequestCard({
  request,
  onResolved,
}: {
  request: AppRequest;
  onResolved?: (request: AppRequest) => void;
}) {
  const now = useNow();
  const [current, setCurrent] = useState(request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setCurrent(request), [request]);
  const expired = current.state === "pending" && Date.parse(current.expiresAt) <= now;
  const pending = current.state === "pending" && !expired;
  const resolved = useRef(onResolved);
  resolved.current = onResolved;
  const answered = (next: AppRequest) => {
    setCurrent(next);
    if (next.state !== "pending") resolved.current?.(next);
  };
  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn’t go through. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const decide = (decision: AppRequestDecision) =>
    act(async () => answered((await appsApi.decide(current.id, decision)).request));

  const logo = current.subject ? (
    <BrandIcon
      brand={current.subject}
      size={16}
      className="mr-1.5 inline-block align-[-0.1875rem]"
    />
  ) : null;
  const row: StatusState = pending
    ? "waiting"
    : current.state === "connected" || current.state === "approved" || current.state === "used"
      ? "done"
      : current.state === "declined"
        ? "skipped"
        : "failed";
  const actions = pending ? (
    // A Connect card from before apps were only connected directly can only be put aside.
    current.kind === "connect" ? (
      <Button variant="quiet" disabled={busy} onClick={() => void decide("deny")}>
        Not now
      </Button>
    ) : (
      <ApprovalActions
        request={current}
        busy={busy}
        onDecide={(decision) => void decide(decision)}
      />
    )
  ) : undefined;
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (
    <>
      <StatusTable label={current.title} actions={actions}>
        <StatusRow
          state={row}
          verb={pending ? "Waiting for you" : stateLabel(current, expired)}
          sub={
            (current.summary && (
              <span
                className="mt-1.5 block max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                tabIndex={0}
              >
                {current.summary}
              </span>
            )) ||
            undefined
          }
        >
          {logo}
          {current.title}
        </StatusRow>
      </StatusTable>
    </>
  );
}
