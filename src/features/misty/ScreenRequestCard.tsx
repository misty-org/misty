import { AppWindow, Monitor, MousePointer2, PanelsTopLeft } from "lucide-react";
import type { ScreenRequest } from "@/features/ai-surface/types";
import { Button, Spinner } from "@/shared/ui";
import {
  declineScreenRequest,
  openScreenAndContinue,
  screenChoice,
  type ScreenChoice,
} from "./screenRequests";
import { useMistyStore } from "./useMistyStore";

function status(request: ScreenRequest) {
  const look = request.kind === "look";
  if (request.kind === "desktop")
    return {
      opening: "Starting desktop control…",
      opened: "Continuing on your desktop",
      declined: "Desktop not used",
      failed: request.error || "Desktop control could not start.",
      pending: "Starting desktop control…",
    }[request.state ?? "pending"];
  switch (request.state) {
    case "opening":
      return look ? "Looking at your screen…" : "Opening a screen…";
    case "opened":
      return look ? "Continuing with your screen" : "Continuing with the screen open";
    case "declined":
      return "Not opened";
    case "failed":
      return request.error || "The screen could not open.";
    default:
      return look ? "Looking at your screen…" : "Opening a screen…";
  }
}

/** Shows a screen the agent asked for; with "Ask each time", lets the user pick where. */
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
  const choose = (choice: ScreenChoice) => {
    if (conversationId)
      void openScreenAndContinue(
        useMistyStore.setState,
        useMistyStore.getState,
        conversationId,
        messageId,
        choice,
      );
  };
  const Icon =
    request.kind === "look" ? Monitor : request.kind === "desktop" ? MousePointer2 : AppWindow;
  return (
    <section
      aria-label={
        request.kind === "look"
          ? "Screen look"
          : request.kind === "desktop"
            ? "Desktop request"
            : "Screen request"
      }
      className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-cream-muted" aria-hidden="true" />
        <strong className="text-xs text-cream-bright">
          {asking ? "Where should Misty work?" : status(request)}
        </strong>
        {request.state === "opening" ? <Spinner label={false} className="size-3" /> : null}
      </div>
      <p className="mt-1.5 break-words text-[11px] leading-4 text-cream-muted">{request.reason}</p>
      {stalled ? (
        <div className="mt-3">
          <Button size="sm" className="h-7" onClick={() => choose(screenChoice(request.location))}>
            Continue
          </Button>
        </div>
      ) : null}
      {asking ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-7" disabled={working} onClick={() => choose("window")}>
            <AppWindow className="size-3.5" /> New tab
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={working}
            onClick={() => choose("separate")}
          >
            <PanelsTopLeft className="size-3.5" /> Separate window
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
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
        </div>
      ) : null}
    </section>
  );
}
