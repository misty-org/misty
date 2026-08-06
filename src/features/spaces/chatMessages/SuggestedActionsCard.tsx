import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, CheckSquare, FileText, Lightbulb, Map, Timer } from "lucide-react";
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui";
import type {
  SpaceActionSuggestionBatch,
  SpaceActionSuggestionItem,
  SpaceAgentMembership,
  SpaceCalendarSource,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceRoadmap } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export function SuggestedActionsCard({
  spaceId,
  batch,
  onChanged,
}: {
  spaceId: string;
  batch: SpaceActionSuggestionBatch;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dismiss = async () => {
    setBusy(true);
    try {
      await spacesApi.dismissActionSuggestion(spaceId, batch.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="ml-[60px] my-3 rounded-xl border border-primary/20 bg-primary/[0.045] p-3"
      aria-label="Suggested actions"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Lightbulb size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Suggested actions</p>
          <p className="mb-0 mt-1 text-xs leading-relaxed text-muted-foreground">
            Misty noticed a concrete agreement. Nothing happens until someone reviews and accepts
            it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {batch.items.map((item) => (
              <span key={item.id} className="rounded-md border bg-background/70 px-2 py-1 text-xs">
                {item.title}
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss()}>
            Dismiss
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setOpen(true)}>
            Review
          </Button>
        </div>
      </div>
      <SuggestionReviewDialog
        spaceId={spaceId}
        batch={batch}
        open={open}
        onOpenChange={setOpen}
        onChanged={onChanged}
      />
    </section>
  );
}

type DraftItem = { selected: boolean; agentId: string; input: Record<string, unknown> };
type RecipientOption = { id: string; name: string };

function SuggestionReviewDialog({
  spaceId,
  batch,
  open,
  onOpenChange,
  onChanged,
}: {
  spaceId: string;
  batch: SpaceActionSuggestionBatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [agentsByItem, setAgentsByItem] = useState<Record<string, SpaceAgentMembership[]>>({});
  const [calendarSources, setCalendarSources] = useState<SpaceCalendarSource[]>([]);
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [audience, setAudience] = useState<"space" | "conversation">(
    batch.scope.kind === "everyone" ? "space" : "conversation",
  );
  const [drafts, setDrafts] = useState<Record<string, DraftItem>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const needsCalendar = batch.items.some((item) => item.action_kind === "calendar.event.create");
    const needsRoadmap = batch.items.some((item) => item.action_kind === "roadmap.item.create");
    void Promise.all([
      spacesApi.actionSuggestionReview(spaceId, batch.id),
      needsCalendar
        ? spacesApi.calendarSources(spaceId).catch(() => ({ sources: [] }))
        : Promise.resolve({ sources: [] }),
      needsRoadmap
        ? spacesApi.roadmaps(spaceId).catch(() => ({ roadmaps: [] }))
        : Promise.resolve({ roadmaps: [] }),
      batch.scope.kind === "everyone"
        ? spacesApi
            .members(spaceId)
            .then((result) =>
              result.members.map((member) => ({ id: member.user_id, name: member.name })),
            )
        : spacesApi.conversations(spaceId).then(
            (result) =>
              result.conversations
                .find((conversation) => conversation.id === batch.scope.conversation_id)
                ?.participants.filter((participant) => participant.kind === "person")
                .map((participant) => ({ id: participant.user_id ?? "", name: participant.name }))
                .filter((participant) => participant.id) ?? [],
          ),
    ])
      .then(([review, sources, roadmapResult, recipientOptions]) => {
        setAgentsByItem(review.eligible_agents_by_item ?? {});
        setAudience(review.destination_audience.kind);
        setCalendarSources(
          sources.sources.filter(
            (source) => review.destination_audience.kind === "space" || source.id === "misty",
          ),
        );
        setRoadmaps(
          roadmapResult.roadmaps.filter(
            (roadmap) =>
              roadmap.audience_kind === review.destination_audience.kind &&
              (roadmap.audience_kind === "space" ||
                roadmap.audience_conversation_id === review.destination_audience.conversation_id),
          ),
        );
        setRecipients(recipientOptions);
        setDrafts(
          Object.fromEntries(
            review.suggestion.items.map((item) => [
              item.id,
              {
                selected: true,
                agentId: review.eligible_agents_by_item?.[item.id]?.[0]?.agent_id ?? "",
                input: { ...item.proposed_input },
              },
            ]),
          ),
        );
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "This suggestion is no longer available.",
        ),
      );
  }, [batch.id, open, spaceId]);
  const selected = useMemo(
    () => batch.items.filter((item) => drafts[item.id]?.selected),
    [batch.items, drafts],
  );
  const update = (id: string, patch: Partial<DraftItem>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await spacesApi.acceptActionSuggestion(
        spaceId,
        batch.id,
        batch.version,
        selected.map((item) => ({
          item_id: item.id,
          selected_agent_id: drafts[item.id].agentId,
          approved_input: drafts[item.id].input,
        })),
      );
      onOpenChange(false);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action could not be accepted.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review suggested actions</DialogTitle>
          <DialogDescription>
            Choose what to create, edit the details, and select the participating agent that will
            perform each action.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/25 px-3 py-2 text-xs">
          <strong>Destination:</strong>{" "}
          {audience === "space" ? "Everyone in this Space" : "Only people in this conversation"}
        </div>
        <div className="grid gap-3">
          {batch.items.map((item) => (
            <ReviewItem
              key={item.id}
              item={item}
              draft={drafts[item.id]}
              agents={agentsByItem[item.id] ?? []}
              calendarSources={calendarSources}
              roadmaps={roadmaps}
              recipients={recipients}
              onChange={(patch) => update(item.id, patch)}
            />
          ))}
        </div>
        {error ? (
          <p className="m-0 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              busy || selected.length === 0 || selected.some((item) => !drafts[item.id]?.agentId)
            }
            onClick={() => void accept()}
          >
            {busy ? "Creating…" : `Accept ${selected.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewItem({
  item,
  draft,
  agents,
  calendarSources,
  roadmaps,
  recipients,
  onChange,
}: {
  item: SpaceActionSuggestionItem;
  draft: DraftItem | undefined;
  agents: SpaceAgentMembership[];
  calendarSources: SpaceCalendarSource[];
  roadmaps: SpaceRoadmap[];
  recipients: RecipientOption[];
  onChange: (patch: Partial<DraftItem>) => void;
}) {
  if (!draft) return null;
  const Icon = {
    "task.create": CheckSquare,
    "calendar.event.create": CalendarPlus,
    "journal.note.create": FileText,
    "roadmap.item.create": Map,
    "conversation.follow_up.schedule": Timer,
  }[item.action_kind];
  return (
    <article className={`rounded-xl border p-3 ${draft.selected ? "bg-card" : "opacity-60"}`}>
      <div className="flex items-start gap-2">
        <Checkbox
          className="mt-1 size-4"
          checked={draft.selected}
          aria-label={`Select ${item.title}`}
          onCheckedChange={(checked) => onChange({ selected: checked === true })}
        />
        <Icon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">{item.title}</p>
          {item.summary ? (
            <p className="mb-0 mt-0.5 text-xs text-muted-foreground">{item.summary}</p>
          ) : null}
        </div>
      </div>
      {draft.selected ? (
        <div className="ml-6 mt-3 grid gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Agent
            <Select value={draft.agentId} onValueChange={(agentId) => onChange({ agentId })}>
              <SelectTrigger aria-label="Agent">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.agent_id} value={agent.agent_id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(draft.input).map(([key, value]) => (
              <SuggestionField
                key={key}
                field={key}
                value={value}
                calendarSources={calendarSources}
                roadmaps={roadmaps}
                recipients={recipients}
                onChange={(next) => onChange({ input: { ...draft.input, [key]: next } })}
              />
            ))}
          </div>
          {item.action_kind === "calendar.event.create" &&
          draft.input.calendar_source_id !== undefined &&
          draft.input.calendar_source_id !== "misty" ? (
            <p className="m-0 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              Accepting approves this exact external calendar write.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SuggestionField({
  field,
  value,
  calendarSources,
  roadmaps,
  recipients,
  onChange,
}: {
  field: string;
  value: unknown;
  calendarSources: SpaceCalendarSource[];
  roadmaps: SpaceRoadmap[];
  recipients: RecipientOption[];
  onChange: (value: unknown) => void;
}) {
  const label = field.replace(/_/g, " ").replace(/^./, (letter: string) => letter.toUpperCase());
  const isDate = field.endsWith("_at");
  const displayed = Array.isArray(value)
    ? value.join(", ")
    : typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "";
  if (field === "calendar_source_id") {
    return (
      <label className="grid gap-1 text-xs font-medium">
        Calendar
        <Select value={displayed || "misty"} onValueChange={onChange}>
          <SelectTrigger aria-label="Calendar destination">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {calendarSources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }
  if (field === "roadmap_id") {
    return (
      <label className="grid gap-1 text-xs font-medium">
        Roadmap
        <Select
          value={displayed || "new"}
          onValueChange={(next) => onChange(next === "new" ? "" : next)}
        >
          <SelectTrigger aria-label="Roadmap destination">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Create a new roadmap</SelectItem>
            {roadmaps.map((roadmap) => (
              <SelectItem key={roadmap.id} value={roadmap.id}>
                {roadmap.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }
  if (field === "recipient_user_ids") {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    return (
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-xs font-medium">Recipients</legend>
        <div className="flex flex-wrap gap-3 rounded-md border p-2">
          {recipients.map((recipient) => (
            <label key={recipient.id} className="flex items-center gap-2 text-xs font-normal">
              <Checkbox
                checked={selected.includes(recipient.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, recipient.id]
                      : selected.filter((id) => id !== recipient.id),
                  )
                }
              />
              {recipient.name}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <label
      className={cn(
        "grid gap-1 text-xs font-medium",
        (field === "description" ||
          field === "notes" ||
          field === "markdown" ||
          field === "reminder_text") &&
          "sm:col-span-2",
      )}
    >
      {label}
      <Input
        type={isDate ? "datetime-local" : "text"}
        value={isDate && displayed ? displayed.slice(0, 16) : displayed}
        onChange={(event) =>
          onChange(
            Array.isArray(value)
              ? event.target.value
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean)
              : isDate && event.target.value
                ? new Date(event.target.value).toISOString()
                : event.target.value,
          )
        }
      />
    </label>
  );
}
