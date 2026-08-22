import { routes } from "@/features/app-shell/routes";
import { Button, cn } from "@/shared/ui";
import { ArrowUpRight, Bot, Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { aiSurfaceApi } from "./api";
import { useAiSurfaceStore } from "./store";
import type {
  AiArtifact,
  AiCitation,
  AiDrawerMessage,
  AiRunRoutingOption,
  AiSurfaceAdapter,
} from "./types";

export function AiMessage({
  message,
  adapter,
  accountId,
  paneId,
  handoffPrompt,
  onDecision,
}: {
  message: AiDrawerMessage;
  adapter: AiSurfaceAdapter;
  accountId: string;
  paneId: string;
  handoffPrompt: string;
  onDecision: (artifact: AiArtifact, decision: "accept" | "reject" | "refine") => void;
}) {
  return (
    <article
      className={cn(
        "rounded-xl px-3 py-2.5 text-sm leading-relaxed",
        message.role === "user"
          ? "ml-8 bg-cream text-charcoal-bg"
          : "mr-2 border border-charcoal-border bg-charcoal-bg text-cream",
      )}
    >
      <p className="m-0 whitespace-pre-wrap">{message.content}</p>
      {message.citations.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {message.citations.map((citation) => (
            <button
              key={citation.id}
              type="button"
              className="rounded-full border border-charcoal-border bg-charcoal-card px-2 py-1 text-[10px] text-cream-muted hover:text-cream"
              onClick={() => openCitation(adapter, citation)}
            >
              {citation.title}
            </button>
          ))}
        </div>
      ) : null}
      {message.artifacts.map((artifact) => (
        <AiArtifactCard
          key={artifact.id}
          artifact={artifact}
          applicable={Boolean(
            artifact.kind === "task_set" ||
            (adapter.applyArtifact && adapter.canApply?.(artifact) !== false),
          )}
          onDecision={onDecision}
        />
      ))}
      {message.role === "assistant" && message.content ? (
        <div className="mt-2 flex items-end justify-between gap-2">
          <AiHandoffControls
            accountId={accountId}
            paneId={paneId}
            adapter={adapter}
            invocationId={message.invocationId}
            prompt={handoffPrompt}
          />
          <AiFeedbackControls invocationId={message.invocationId} />
        </div>
      ) : null}
    </article>
  );
}

function AiArtifactCard({
  artifact,
  applicable,
  onDecision,
}: {
  artifact: AiArtifact;
  applicable: boolean;
  onDecision: (artifact: AiArtifact, decision: "accept" | "reject" | "refine") => void;
}) {
  const pending = artifact.state === "proposed";
  const [confirming, setConfirming] = useState(false);
  const [draftOperations, setDraftOperations] = useState(artifact.operations);
  const decisionArtifact = { ...artifact, operations: draftOperations };
  const requiresConfirmation =
    artifact.approvalPolicy === "confirm" || artifact.approvalPolicy === "always_confirm";
  return (
    <section className="mt-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="m-0 text-xs font-semibold">{artifact.title}</h4>
          <p className="mb-0 mt-1 text-[11px] text-cream-muted">{artifact.summary}</p>
        </div>
        <span className="rounded-full bg-charcoal-bg px-2 py-1 text-[9px] uppercase tracking-wide text-cream-muted">
          {artifact.risk}
        </span>
      </div>
      <AiArtifactPreview
        artifact={decisionArtifact}
        editable={pending && artifact.kind === "task_set"}
        onChange={setDraftOperations}
      />
      {artifact.error ? (
        <p className="mb-0 mt-2 text-xs text-notification-red">{artifact.error}</p>
      ) : null}
      {pending ? (
        <div className="mt-3 flex gap-2">
          {!applicable ? (
            <p className="m-0 self-center text-[10px] text-cream-muted">
              Preview only. This surface does not currently expose a safe apply capability.
            </p>
          ) : requiresConfirmation && !confirming ? (
            <Button type="button" size="sm" className="h-7" onClick={() => setConfirming(true)}>
              Review &amp; confirm
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7"
              onClick={() => onDecision(decisionArtifact, "accept")}
            >
              <Check className="size-3.5" />
              {requiresConfirmation ? confirmationLabel(artifact) : "Apply"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => onDecision(decisionArtifact, "reject")}
          >
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => onDecision(decisionArtifact, "refine")}
          >
            Request changes
          </Button>
        </div>
      ) : (
        <p className="mb-0 mt-2 text-[10px] capitalize text-cream-muted">
          {artifact.state.replace("_", " ")}
        </p>
      )}
    </section>
  );
}

function AiArtifactPreview({
  artifact,
  editable,
  onChange,
}: {
  artifact: AiArtifact;
  editable: boolean;
  onChange: (operations: unknown) => void;
}) {
  if (artifact.kind !== "task_set") {
    return (
      <div className="mt-3">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-cream-muted">
          Exact proposed operations
        </p>
        <pre
          className={cn(
            "misty-transient-scrollbar m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md",
            "border border-charcoal-border bg-charcoal-bg p-2 text-[10px] leading-relaxed text-cream-muted",
          )}
        >
          {JSON.stringify(artifact.operations, null, 2)}
        </pre>
        {artifact.approvalPolicy === "always_confirm" ? (
          <p className="mb-0 mt-1.5 text-[10px] text-cream-muted">
            This operation cannot inherit blanket approval. Its targets and effects must be
            confirmed here, and the destination may require a fresh capability grant.
          </p>
        ) : null}
      </div>
    );
  }
  const tasks =
    (
      artifact.operations as {
        tasks?: Array<{ id?: string; title?: string; notes?: string; priority?: string }>;
      }
    ).tasks ?? [];
  return (
    <div className="mt-3 space-y-1.5" aria-label="Tasks to create">
      {tasks.map((task, index) => (
        <div
          key={task.id ?? index}
          className="rounded-md border border-charcoal-border bg-charcoal-bg px-2.5 py-2"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 size-3.5 shrink-0 rounded border border-cream-muted/50" />
            <div className="min-w-0 flex-1">
              {editable ? (
                <>
                  <input
                    className="w-full border-0 bg-transparent p-0 text-xs font-medium outline-none"
                    value={task.title ?? ""}
                    maxLength={240}
                    aria-label={`Task ${index + 1} title`}
                    onChange={(event) =>
                      onChange({
                        ...(artifact.operations as Record<string, unknown>),
                        tasks: tasks.map((item, taskIndex) =>
                          taskIndex === index ? { ...item, title: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <textarea
                    className="mt-1 min-h-8 w-full resize-y border-0 bg-transparent p-0 text-[10px] text-cream-muted outline-none"
                    value={task.notes ?? ""}
                    maxLength={20000}
                    aria-label={`Task ${index + 1} notes`}
                    placeholder="Optional notes"
                    onChange={(event) =>
                      onChange({
                        ...(artifact.operations as Record<string, unknown>),
                        tasks: tasks.map((item, taskIndex) =>
                          taskIndex === index ? { ...item, notes: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <p className="m-0 text-xs font-medium">{task.title || "Untitled task"}</p>
                  {task.notes ? (
                    <p className="mb-0 mt-1 line-clamp-2 text-[10px] text-cream-muted">
                      {task.notes}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <span className="rounded bg-charcoal-card px-1.5 py-0.5 text-[9px] capitalize text-cream-muted">
              {task.priority || "medium"}
            </span>
          </div>
        </div>
      ))}
      {artifact.approvalPolicy === "confirm" ? (
        <p className="m-0 text-[10px] text-cream-muted">
          This creates new objects in the current Space. Nothing is assigned or scheduled.
        </p>
      ) : null}
    </div>
  );
}

function confirmationLabel(artifact: AiArtifact) {
  if (artifact.kind === "task_set") {
    const count = (artifact.operations as { tasks?: unknown[] }).tasks?.length ?? 0;
    return `Create ${count} task${count === 1 ? "" : "s"}`;
  }
  return "Confirm change";
}

function AiFeedbackControls({ invocationId }: { invocationId?: string }) {
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const rate = (next: -1 | 1) => {
    if (!invocationId || rating) return;
    setRating(next);
    void aiSurfaceApi.feedback(invocationId, next).catch(() => setRating(null));
  };
  return (
    <div className="flex justify-end gap-0.5 text-cream-muted" aria-label="Rate this answer">
      <button
        type="button"
        className={cn("rounded p-1 hover:text-cream", rating === 1 && "text-cream")}
        aria-label="Useful answer"
        aria-pressed={rating === 1}
        disabled={!invocationId}
        onClick={() => rate(1)}
      >
        <ThumbsUp className="size-3" />
      </button>
      <button
        type="button"
        className={cn("rounded p-1 hover:text-cream", rating === -1 && "text-cream")}
        aria-label="Not useful answer"
        aria-pressed={rating === -1}
        disabled={!invocationId}
        onClick={() => rate(-1)}
      >
        <ThumbsDown className="size-3" />
      </button>
    </div>
  );
}

function AiHandoffControls({
  accountId,
  paneId,
  adapter,
  invocationId,
  prompt,
}: {
  accountId: string;
  paneId: string;
  adapter: AiSurfaceAdapter;
  invocationId?: string;
  prompt: string;
}) {
  const navigate = useNavigate();
  const pinnedAgent = useAiSurfaceStore((state) => state.pinnedAgent(accountId, adapter.surfaceId));
  const [selectedAgentId, setSelectedAgentId] = useState(pinnedAgent ?? "");
  const [route, setRoute] = useState<AiRunRoutingOption | null>(null);
  const [options, setOptions] = useState<AiRunRoutingOption[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ href: string; status: string } | null>(null);
  const idempotencyKey = useRef(`ai-handoff-${crypto.randomUUID()}`);

  useEffect(() => {
    setSelectedAgentId(pinnedAgent ?? "");
  }, [pinnedAgent]);

  const openAgents = (href: string = routes.agents) => navigate(href);
  const handoff = async () => {
    setWorking(true);
    setError("");
    try {
      const context = adapter.getContext();
      const sharedSpace =
        route?.space_id ?? context.find((item) => item.privacy === "shared")?.spaceId;
      const response = await aiSurfaceApi.createRun({
        prompt,
        surfaceId: adapter.surfaceId,
        paneId,
        invocationId,
        agentId: route?.agent_id ?? selectedAgentId,
        spaceId: sharedSpace,
        context,
        href: `${window.location.pathname}${window.location.search}`,
        title: adapter.label,
        idempotencyKey: idempotencyKey.current,
      });
      if (response.routing?.needs_clarification && response.routing.options?.length) {
        setOptions(response.routing.options);
        setRoute(response.routing.options[0]);
        return;
      }
      const href = response.agents_href ?? routes.agents;
      setCreated({ href, status: response.status || response.run?.state || "queued" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This result could not be handed off.");
    } finally {
      setWorking(false);
    }
  };

  if (created) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-cream-muted hover:bg-charcoal-card hover:text-cream"
        onClick={() => openAgents(created.href)}
      >
        <Bot className="size-3" /> Agent {created.status.replace(/_/g, " ")}
        <ArrowUpRight className="size-3" />
      </button>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        {options.length ? (
          <select
            className="h-7 max-w-44 rounded border border-charcoal-border bg-charcoal-card px-1.5 text-[10px] text-cream"
            aria-label="Choose Agent and Space"
            value={route ? `${route.space_id}:${route.agent_id}:${route.capability_id}` : ""}
            onChange={(event) =>
              setRoute(
                options.find(
                  (option) =>
                    `${option.space_id}:${option.agent_id}:${option.capability_id}` ===
                    event.target.value,
                ) ?? null,
              )
            }
          >
            {options.map((option) => (
              <option
                key={`${option.space_id}:${option.agent_id}:${option.capability_id}`}
                value={`${option.space_id}:${option.agent_id}:${option.capability_id}`}
              >
                {option.agent_name} · {option.space_name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded px-1.5 text-[10px] text-cream-muted hover:bg-charcoal-card hover:text-cream disabled:opacity-50"
          disabled={working}
          onClick={() => void handoff()}
        >
          {working ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />}
          {options.length ? "Confirm handoff" : selectedAgentId ? "Hand off" : "Choose Agent"}
        </button>
      </div>
      {error ? <p className="mb-0 mt-1 text-[10px] text-notification-red">{error}</p> : null}
    </div>
  );
}

export function handoffPromptFor(messages: AiDrawerMessage[], index: number) {
  const assistant = messages[index];
  if (!assistant || assistant.role !== "assistant") return "";
  const user = messages
    .slice(0, index)
    .reverse()
    .find((item) => item.role === "user");
  return [
    "Continue this work as a durable Agent run. Preserve the user's intent and verify before taking consequential actions.",
    user?.content ? `Original request:\n${user.content}` : "",
    `Misty result:\n${assistant.content}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function openCitation(adapter: AiSurfaceAdapter, citation: AiCitation) {
  if (adapter.openCitation) adapter.openCitation(citation);
  else if (citation.href)
    window.dispatchEvent(new CustomEvent("misty:open-ai-citation", { detail: citation }));
}
