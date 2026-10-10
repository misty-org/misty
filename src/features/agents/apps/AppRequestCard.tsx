import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { BrandIcon, brandIconAsset, Button } from "@/shared/ui";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";
import { appsApi, type AppRequest, type AppRequestDecision } from "./api";
import { ApprovalActions } from "./ApprovalActions";
import { PickAccountActions } from "./PickAccountActions";

function stateLabel(request: AppRequest, expired: boolean) {
  if (expired) return "Expired";
  switch (request.state) {
    case "connected":
      return request.kind === "pick" ? "Added to this Space" : "Connected";
    case "approved":
      return "Accepted";
    case "used":
      return "Accepted and done";
    case "declined":
      return request.kind === "connect"
        ? "Not connected"
        : request.kind === "pick"
          ? "Not added"
          : "Denied";
    default:
      return "Expired";
  }
}

// How often a Connect card checks for the finished sign-in.
const connectPollMs = 3_000;

/**
 * In-chat card for something the agent needs: connect an app, pick which account
 * the Space uses, or approve one action. `onResolved` hears every answer, including a sign-in finished in the
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
  const pick = (account: string) =>
    act(async () => answered((await appsApi.pick(current.id, account)).request));
  const decide = (decision: AppRequestDecision) =>
    act(async () => answered((await appsApi.decide(current.id, decision)).request));

  const logo = brandIconAsset(current.subject) ? (
    <BrandIcon brand={current.subject} size={16} className="mr-1.5 inline-block align-[-3px]" />
  ) : null;
  const row: StatusState = pending
    ? "waiting"
    : current.state === "connected" || current.state === "approved" || current.state === "used"
      ? "done"
      : current.state === "declined"
        ? "skipped"
        : "failed";
  const actions = pending ? (
    current.kind === "connect" ? (
      <>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void connect()}>
          <ExternalLink className="size-3.5" /> {opened ? "Open sign-in again" : "Connect"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("deny")}>
          Not now
        </Button>
      </>
    ) : current.kind === "pick" ? (
      <PickAccountActions
        app={current.subject}
        busy={busy}
        onPick={(account) => void pick(account)}
        onDismiss={() => void decide("deny")}
      />
    ) : (
      <ApprovalActions
        request={current}
        busy={busy}
        onDecide={(decision) => void decide(decision)}
      />
    )
  ) : undefined;
  return (
    <StatusTable label={current.title} actions={actions}>
      <StatusRow
        state={row}
        verb={pending ? "Waiting for you" : stateLabel(current, expired)}
        sub={
          error ||
          (pending && current.kind === "connect" && opened
            ? "Finish signing in in your browser. Misty continues when you’re done."
            : current.summary) ||
          undefined
        }
      >
        {logo}
        {current.title}
      </StatusRow>
    </StatusTable>
  );
}
