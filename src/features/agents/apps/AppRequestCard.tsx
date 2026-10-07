import { Check, ExternalLink, Plug, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button } from "@/shared/ui";
import { appsApi, type AppRequest } from "./api";

function stateLabel(request: AppRequest, expired: boolean) {
  if (expired) return "Expired";
  switch (request.state) {
    case "connected":
      return "Connected";
    case "approved":
      return "Approved";
    case "used":
      return "Approved and done";
    case "declined":
      return request.kind === "connect" ? "Not connected" : "Declined";
    default:
      return "Expired";
  }
}

// How often a Connect card checks for the finished sign-in.
const connectPollMs = 3_000;

/**
 * In-chat card for something the agent needs: connect an app or approve one
 * action. `onResolved` hears every answer, including a sign-in finished in the
 * browser, so the conversation can continue.
 */
export function AppRequestCard({
  request,
  onResolved,
}: {
  request: AppRequest;
  onResolved?: (request: AppRequest) => void;
}) {
  const [current, setCurrent] = useState(request);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setCurrent(request), [request]);
  const expired = current.state === "pending" && Date.parse(current.expiresAt) <= Date.now();
  const pending = current.state === "pending" && !expired;
  const resolved = useRef(onResolved);
  resolved.current = onResolved;
  const answered = (next: AppRequest) => {
    setCurrent(next);
    if (next.state !== "pending") resolved.current?.(next);
  };
  // After sign-in opens, check until the app is connected or the card expires.
  useEffect(() => {
    if (!pending || current.kind !== "connect" || !opened) return;
    let stopped = false;
    const timer = setInterval(() => {
      void appsApi
        .request(current.id)
        .then(({ request: next }) => {
          if (!stopped && next.state !== "pending") answered(next);
        })
        .catch(() => undefined);
    }, connectPollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, current.kind, current.id, opened]);

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
  const connect = () =>
    act(async () => {
      const { url } = await appsApi.requestLink(current.id);
      await openExternalLink(url);
      setOpened(true);
    });
  const decide = (decision: "approve" | "decline") =>
    act(async () => answered((await appsApi.decide(current.id, decision)).request));

  const Icon = current.kind === "connect" ? Plug : ShieldQuestion;
  return (
    <section
      aria-label={current.title}
      className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-cream-muted" aria-hidden="true" />
        <strong className="text-xs text-cream-bright">{current.title}</strong>
      </div>
      {current.summary ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-4 text-cream-muted">
          {current.summary}
        </p>
      ) : null}
      {pending && current.kind === "connect" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-7" disabled={busy} onClick={() => void connect()}>
            <ExternalLink className="size-3.5" /> {opened ? "Open sign-in again" : "Connect"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy}
            onClick={() => void decide("decline")}
          >
            Not now
          </Button>
          {opened ? (
            <p className="text-[11px] text-cream-muted">
              Finish signing in in your browser. Misty continues when you’re done.
            </p>
          ) : null}
        </div>
      ) : pending ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="h-7" disabled={busy} onClick={() => void decide("approve")}>
            <Check className="size-3.5" /> Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy}
            onClick={() => void decide("decline")}
          >
            Decline
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-cream-muted">{stateLabel(current, expired)}</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-cream-muted">
          {error}
        </p>
      ) : null}
    </section>
  );
}
