import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, LockKeyhole, Send, X } from "lucide-react";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import type {
  AgentConversation,
  AgentConversationEvent,
  RunAction,
  RunApproval,
  SpaceRun,
  SpaceStudioResource,
} from "../../spaces/types";
import { errorText } from "@/shared/format";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../components/ui/sheet";
import { EmptyState, LoadingState } from "@/components/ui/state-view";

export function AgentConversationPanel({
  agent,
  conversationId,
  embedded = false,
  returnFocusRef,
  onClose,
}: {
  agent: SpaceStudioResource;
  conversationId?: string;
  embedded?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [events, setEvents] = useState<AgentConversationEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pendingRun, setPendingRun] = useState<SpaceRun | null>(null);
  const [latestRunDetail, setLatestRunDetail] = useState<{
    run: SpaceRun;
    actions: RunAction[];
    approvals: RunApproval[];
  } | null>(null);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    void agentArchitectureApi
      .conversations()
      .then(async ({ conversations }) => {
        if (!active) return;
        const existing =
          conversations.find((item) =>
            conversationId
              ? item.id === conversationId &&
                item.agent_id === agent.id &&
                item.space_id === agent.space_id
              : item.agent_id === agent.id && item.space_id === agent.space_id,
          ) ?? null;
        setConversation(existing);
        if (existing)
          await loadConversationState(
            existing.id,
            () => active,
            setEvents,
            setLatestRunDetail,
            setPendingRun,
            setError,
          );
      })
      .catch((reason) => active && setError(errorText(reason)))
      .finally(() => active && setHistoryLoading(false));
    return () => {
      active = false;
    };
  }, [agent.id, agent.space_id, conversationId]);
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, pendingRun?.id]);
  const ensureConversation = async () => {
    if (conversation) return conversation;
    const created = await agentArchitectureApi.createConversation(
      agent.space_id,
      agent.id,
      `Chat with ${agent.name}`,
    );
    setConversation(created);
    return created;
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setPrompt("");
    let target = conversation;
    try {
      target = await ensureConversation();
      const response = await agentArchitectureApi.sendConversationMessage(target.id, {
        prompt: text,
        input: { prompt: text },
      });
      setPendingRun(response.run?.state === "awaiting_approval" ? response.run : null);
      await loadConversationState(
        target.id,
        () => true,
        setEvents,
        setLatestRunDetail,
        setPendingRun,
        setError,
      );
    } catch (reason) {
      setError(errorText(reason));
      const loaded = target
        ? await loadConversationState(
            target.id,
            () => true,
            setEvents,
            setLatestRunDetail,
            setPendingRun,
            () => undefined,
          )
        : [];
      const lastUserMessage = [...loaded]
        .reverse()
        .find((event) => event.event_type === "user_message");
      if (lastUserMessage?.data.text !== text) setPrompt((current) => current || text);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (approved: boolean) => {
    if (!pendingRun) return;
    setBusy(true);
    try {
      await agentArchitectureApi.decideRun(pendingRun.id, approved);
      setPendingRun(null);
      if (conversation)
        await loadConversationState(
          conversation.id,
          () => true,
          setEvents,
          setLatestRunDetail,
          setPendingRun,
          setError,
        );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <section
      className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] bg-background"
      role="region"
      aria-label={`Private conversation with ${agent.name}`}
    >
      <header className="flex items-start justify-between border-b border-border p-4">
        <div>
          <Badge className="gap-1 text-[9px]" variant="secondary">
            <LockKeyhole size={11} />
            Private To You
          </Badge>
          <h2 className="mb-0 mt-2 text-base">{agent.name}</h2>
          <p className="m-0 mt-1 text-[11px] text-muted-foreground">
            This conversation never appears in shared Space chat.
          </p>
        </div>
        <Button
          size="icon"
          variant="outline"
          disabled={busy}
          onClick={onClose}
          aria-label="Close private conversation"
        >
          <X size={15} />
        </Button>
      </header>
      <div className="min-h-0 overflow-auto p-4" aria-busy={historyLoading}>
        {historyLoading ? (
          <LoadingState className="h-full" title="Loading private history" />
        ) : events.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<LockKeyhole />}
            title="Start a private conversation"
            description="Only you can open this thread. Every request still creates an isolated, auditable run."
          />
        ) : (
          <div className="grid gap-2">
            {events
              .filter(
                (event) => event.event_type.endsWith("message") || event.event_type === "error",
              )
              .map((event) => {
                const own = event.event_type === "user_message";
                return (
                  <article
                    className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed ${own ? "ml-10 bg-primary text-primary-foreground" : "mr-10 bg-muted/50"}`}
                    key={event.id}
                  >
                    <div
                      className={`mb-1 flex items-center justify-between gap-3 text-[10px] ${own ? "opacity-70" : "text-muted-foreground"}`}
                    >
                      <span>{own ? "You" : agent.name}</span>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    {eventText(event)}
                  </article>
                );
              })}
            <div ref={historyEndRef} />
          </div>
        )}
      </div>
      <footer className="border-t border-border p-4">
        {latestRunDetail ? (
          <section className="mb-3 rounded-lg bg-muted/40 p-3" aria-label="Latest Space Agent run">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  Latest run · {latestRunDetail.run.state.replace(/_/g, " ")}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">
                  {latestRunDetail.run.capability_id} · {latestRunDetail.run.workflow_identifier}@
                  {latestRunDetail.run.workflow_version}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={runDetailsOpen}
                onClick={() => setRunDetailsOpen((open) => !open)}
              >
                {runDetailsOpen ? "Hide" : "Inspect"}
              </Button>
            </div>
            {runDetailsOpen ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3 text-[10px]">
                <p className="text-muted-foreground">
                  Run {latestRunDetail.run.id} · source {latestRunDetail.run.source_type}
                </p>
                {latestRunDetail.actions.length ? (
                  <div>
                    <strong className="text-muted-foreground">Actions</strong>
                    <ul className="mt-1 grid gap-1 pl-4">
                      {latestRunDetail.actions.map((action) => (
                        <li key={action.id}>
                          {action.summary} · {action.state}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <strong className="text-muted-foreground">Output</strong>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2">
                    {JSON.stringify(latestRunDetail.run.outputs, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {pendingRun ? (
          <Alert className="mb-3 border-[color-mix(in_srgb,var(--misty-warning)_30%,var(--border))] bg-[color-mix(in_srgb,var(--misty-warning)_8%,var(--card))]">
            <LockKeyhole />
            <AlertTitle>This capability needs your approval</AlertTitle>
            <AlertDescription>
              <p>
                {pendingRun.workflow_identifier}@{pendingRun.workflow_version}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  <X />
                  Reject
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void decide(true)}>
                  <Check />
                  Approve
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>Conversation error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            className="min-h-10 flex-1"
            data-dialog-autofocus
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={`Ask ${agent.name}…`}
            aria-label={`Message ${agent.name}`}
          />
          <Button disabled={busy || !prompt.trim()} type="submit">
            <Send />
            {busy ? "Working…" : "Send"}
          </Button>
        </form>
      </footer>
    </section>
  );
  if (embedded) return panel;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <SheetTitle className="sr-only">Private conversation with {agent.name}</SheetTitle>
        <SheetDescription className="sr-only">
          A private Agent conversation visible only to you.
        </SheetDescription>
        {panel}
      </SheetContent>
    </Sheet>
  );
}

async function loadConversationState(
  id: string,
  active: () => boolean,
  setEvents: (items: AgentConversationEvent[]) => void,
  setLatestRunDetail: (
    detail: { run: SpaceRun; actions: RunAction[]; approvals: RunApproval[] } | null,
  ) => void,
  setPendingRun: (run: SpaceRun | null) => void,
  setError: (value: string) => void,
): Promise<AgentConversationEvent[]> {
  try {
    const result = await agentArchitectureApi.conversationEvents(id);
    if (!active()) return result.events;
    setEvents(result.events);
    const runEvent = [...result.events]
      .reverse()
      .find((event) => event.event_type === "run" && typeof event.data.run_id === "string");
    if (!runEvent || typeof runEvent.data.run_id !== "string") {
      setLatestRunDetail(null);
      setPendingRun(null);
      return result.events;
    }
    const detail = await agentArchitectureApi.runDetail(runEvent.data.run_id);
    if (active()) {
      setLatestRunDetail(detail);
      setPendingRun(detail.run.state === "awaiting_approval" ? detail.run : null);
    }
    return result.events;
  } catch (reason) {
    if (active()) setError(errorText(reason));
    return [];
  }
}
function eventText(event: AgentConversationEvent) {
  return typeof event.data.text === "string" && event.data.text.trim()
    ? event.data.text
    : event.event_type === "error"
      ? "The agent run failed."
      : "Agent run updated.";
}
