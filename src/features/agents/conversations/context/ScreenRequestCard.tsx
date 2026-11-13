import { AppWindow } from "lucide-react";
import type { ScreenRequest } from "../../runs/invocations/invocationTypes";
import { Button } from "@/shared/ui";
import { StatusRow, StatusTable, type StatusState } from "../../progress/StatusTable";
import { declineScreenRequest, openScreenAndContinue } from "./screenRequests";
import { useMistyStore } from "../state/useMistyStore";

function status(request: ScreenRequest) {
  const look = request.kind === "look";
  if (request.kind === "desktop")
    return {
      opening: "Starting desktop control",
      opened: "Continuing on your desktop",
      declined: "Desktop not used",
      failed: request.error || "Desktop control could not start.",
      pending: "Starting desktop control",
    }[request.state ?? "pending"];
  switch (request.state) {
    case "opening":
      return look ? "Looking at your screen" : "Opening a screen";
    case "opened":
      return look ? "Continuing with your screen" : "Continuing with the screen open";
    case "declined":
      return "Not opened";
    case "failed":
      return request.error || "The screen could not open.";
    default:
      return look ? "Looking at your screen" : "Opening a screen";
  }
}

/** Shows a screen the agent asked for; with "Ask each time", asks before opening it. */
export function ScreenRequestCard({
  messageId,
  request,
}: {
  messageId: string;
  request: ScreenRequest;
}) {
  const conversationId = useMistyStore(
    (state) =>
      state.conversations.find((conversation) =>
        conversation.messages.some((message) => message.id === messageId),
      )?.id,
  );
  const working = useMistyStore((state) => state.working);
  const asking =
    request.state === "pending" && request.kind === "open" && request.location === "ask";
  // A request restored after a reload no longer continues on its own.
  const stalled = request.state === "pending" && !asking && !working;
  const choose = () => {
    if (conversationId)
      void openScreenAndContinue(
        useMistyStore.setState,
        useMistyStore.getState,
        conversationId,
        messageId,
      );
  };
  const row: StatusState = asking
    ? "waiting"
    : stalled
      ? "waiting"
      : request.state === "opened"
        ? "done"
        : request.state === "failed"
          ? "failed"
          : request.state === "declined"
            ? "skipped"
            : "running";
  const actions =
    stalled || asking ? (
      <>
        {stalled ? (
          <Button variant="primary" onClick={choose}>
            Continue
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={working} onClick={choose}>
              <AppWindow className="size-3.5" /> New tab
            </Button>
            <Button
              variant="quiet"
              onClick={() =>
                conversationId &&
                declineScreenRequest(
                  useMistyStore.setState,
                  useMistyStore.getState,
                  conversationId,
                  messageId,
                )
              }
            >
              Not now
            </Button>
          </>
        )}
      </>
    ) : undefined;
  return (
    <StatusTable
      label={
        request.kind === "look"
          ? "Screen look"
          : request.kind === "desktop"
            ? "Desktop request"
            : "Screen request"
      }
      actions={actions}
    >
      <StatusRow
        state={row}
        verb={asking ? "Waiting for you" : undefined}
        sub={request.reason || undefined}
      >
        {asking ? "Where should Misty work?" : status(request)}
      </StatusRow>
    </StatusTable>
  );
}
