import type { Dispatch, FormEvent, SetStateAction } from "react";

import { TaskCalendarNotice } from "@/features/spaces/components/TaskCalendarNotice";
import {
  Archive,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui";
import { Input } from "@/ui";
import { Label } from "@/ui";
import { Separator } from "@/ui";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/ui";
import { Textarea } from "@/ui";
import type { SpaceIntegration } from "@/models/interfaces/features/spaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceMember,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import {
  TaskEmptyState,
  TaskInlineSelect,
  taskPriorityOptions,
  taskStatusOptions,
} from "./SpaceTaskPrimitives";
import type { TaskDraft } from "@/models/types/features/spaces/SpaceTaskPrimitives";

export function SpaceTaskDrawer({
  draft,
  setDraft,
  editing,
  members,
  busy,
  canManage,
  onClose,
  onSave,
  onArchive,
  onPublishCalendar,
  onDiscardCalendar,
}: {
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>> | ((draft: TaskDraft) => void);
  editing: SpaceTask | null;
  members: SpaceMember[];
  busy: boolean;
  canManage: boolean;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onArchive?: () => void;
  /** Sends this task's schedule edits to Google. Omitted for Misty-only tasks. */
  onPublishCalendar?: () => void;
  /** Drops local schedule edits in favour of what Google holds. */
  onDiscardCalendar?: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="flex w-[min(760px,96vw)] max-w-none flex-col gap-0 bg-background p-0 sm:max-w-none">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSave}>
          <SheetHeader className="border-b border-border/60 px-5 py-4 pr-14 text-left">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle>{editing ? editing.task_key : "New task"}</SheetTitle>
                <SheetDescription>
                  {editing
                    ? "Update the task details and assignment."
                    : "Create a shared task for this Space."}
                </SheetDescription>
              </div>
              {onArchive ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" type="button" aria-label="Task actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={onArchive}
                    >
                      <Archive className="mr-2 size-4" />
                      Archive task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px] overflow-auto max-sm:grid-cols-1">
            <div className="grid content-start gap-5 p-5 sm:p-6">
              {editing && onPublishCalendar && onDiscardCalendar ? (
                <TaskCalendarNotice
                  task={editing}
                  busy={busy}
                  canManage={canManage}
                  onPublish={onPublishCalendar}
                  onDiscard={onDiscardCalendar}
                />
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="space-task-title">Title</Label>
                <Input
                  id="space-task-title"
                  autoFocus
                  className="h-auto border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                  maxLength={240}
                  required
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  aria-label="Title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="space-task-notes">Notes</Label>
                <Textarea
                  id="space-task-notes"
                  className="min-h-52 resize-y"
                  maxLength={20_000}
                  placeholder="Add notes"
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                />
              </div>
              {editing &&
              (editing.created_by_agent_id ||
                editing.source_run_id ||
                editing.source_refs.length) ? (
                <div className="rounded-lg bg-muted/30 p-3">
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">
                      Provenance
                    </summary>
                    <div className="mt-2 grid gap-1">
                      {editing.created_by_agent_id ? <span>Generated task</span> : null}
                      <span>
                        {editing.source_refs.length} source
                        {editing.source_refs.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>

            <aside className="grid content-start gap-5 border-l border-border/60 bg-muted/30 p-5 max-sm:border-l-0 max-sm:border-t max-sm:border-border/60">
              <TaskProperty label="Status">
                <TaskInlineSelect
                  label="Task status"
                  disabled={!canManage}
                  value={draft.status}
                  onChange={(value) => setDraft({ ...draft, status: value as SpaceTaskStatus })}
                  options={taskStatusOptions}
                />
              </TaskProperty>
              <TaskProperty label="Priority">
                <TaskInlineSelect
                  label="Task priority"
                  disabled={!canManage}
                  value={draft.priority}
                  onChange={(value) => setDraft({ ...draft, priority: value as SpaceTaskPriority })}
                  options={taskPriorityOptions}
                />
              </TaskProperty>
              <TaskProperty label="Assignee">
                <TaskInlineSelect
                  label="Task assignee"
                  disabled={!canManage}
                  value={draft.assignee_user_id}
                  onChange={(value) => setDraft({ ...draft, assignee_user_id: value })}
                  options={[
                    ["", "Unassigned"],
                    ...members.map((member) => [member.user_id, member.name] as [string, string]),
                  ]}
                />
              </TaskProperty>
              <TaskProperty label="Due date">
                <Input
                  type="datetime-local"
                  value={draft.due_at}
                  onChange={(event) => setDraft({ ...draft, due_at: event.target.value })}
                />
              </TaskProperty>
            </aside>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-border/60 px-5 py-4">
            <Button variant="outline" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !canManage || !draft.title.trim()} type="submit">
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function SpaceTaskEventDrawer({
  event,
  source,
  onClose,
}: {
  event: SpaceCalendarEvent;
  source?: SpaceCalendarSource;
  onClose: () => void;
}) {
  const organizer =
    typeof event.organizer?.email === "string"
      ? event.organizer.email
      : typeof event.organizer?.displayName === "string"
        ? event.organizer.displayName
        : "";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(460px,96vw)] bg-background sm:max-w-[460px]">
        <SheetHeader className="pr-8 text-left">
          <Badge className="mb-1 w-fit" variant="secondary">
            Google Calendar
          </Badge>
          <SheetTitle>{event.title || "Busy"}</SheetTitle>
          <SheetDescription>Published to this Space from an external calendar.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid gap-4">
          <EventFact
            icon={Clock3}
            value={`${formatEventDate(event.starts_at, event.all_day)} – ${formatEventDate(event.ends_at, event.all_day)}`}
          />
          {event.location ? <EventFact icon={CalendarDays} value={event.location} /> : null}
          {organizer ? <EventFact icon={UserRound} value={organizer} /> : null}
          {source ? <EventFact icon={CalendarDays} value={source.display_name} /> : null}
          {event.description ? (
            <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {event.description}
            </p>
          ) : null}
          {event.meeting_url ? (
            <Button asChild className="w-fit" variant="outline">
              <a href={event.meeting_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Join meeting
              </a>
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function CalendarSourceDrawer({
  integrations,
  selectedIntegration,
  choices,
  sources,
  connectionsUnavailable,
  busy,
  onSelect,
  onPublish,
  onDisable,
  onClose,
}: {
  integrations: SpaceIntegration[];
  selectedIntegration: string;
  choices: GoogleCalendarChoice[];
  sources: SpaceCalendarSource[];
  connectionsUnavailable: boolean;
  busy: string;
  onSelect: (id: string) => void;
  onPublish: (choice: GoogleCalendarChoice) => void;
  onDisable: (source: SpaceCalendarSource) => void;
  onClose: () => void;
}) {
  const activeIntegrations = integrations.filter((item) => item.status === "active");
  const published = new Set(
    sources
      .filter((source) => source.status !== "disabled")
      .map((source) => `${source.integration_id}:${source.external_calendar_id}`),
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(480px,96vw)] bg-background p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border/60 px-5 py-4 pr-14 text-left">
          <SheetTitle>Published calendars</SheetTitle>
          <SheetDescription>
            Choose which calendars are visible to members of this Space.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 overflow-auto p-5">
          <TaskInlineSelect
            label="Google account"
            disabled={false}
            value={selectedIntegration}
            onChange={onSelect}
            options={[
              ["", "Choose a Google account"],
              ...activeIntegrations.map((item) => [item.id, item.display_name] as [string, string]),
            ]}
          />

          {connectionsUnavailable ? (
            <TaskEmptyState
              title="Calendar connections unavailable"
              description="Misty could not check Google Calendar connections on this server. Your Space tasks are still available."
            />
          ) : !activeIntegrations.length ? (
            <TaskEmptyState
              title="No Google account connected"
              description="This Space does not currently have a working Google Calendar connection."
            />
          ) : busy === "calendars" ? (
            <div className="grid min-h-40 place-items-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" aria-label="Loading calendars" />
            </div>
          ) : selectedIntegration ? (
            <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-lg bg-muted/30">
              {choices.map((choice) => {
                const active = published.has(`${selectedIntegration}:${choice.id}`);
                return (
                  <div className="flex items-center gap-3 p-3" key={choice.id}>
                    <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{choice.summary}</span>
                    <Button
                      size="sm"
                      variant={active ? "secondary" : "outline"}
                      disabled={active || busy === choice.id}
                      type="button"
                      onClick={() => onPublish(choice)}
                    >
                      {active ? "Added" : "Add"}
                    </Button>
                  </div>
                );
              })}
              {!choices.length ? (
                <p className="text-xs text-muted-foreground">
                  No calendars are available for this account.
                </p>
              ) : null}
            </div>
          ) : null}

          <Separator className="my-5" />
          <h3 className="mb-2 mt-0 text-sm font-semibold">Space calendars</h3>
          <div className="grid gap-1">
            {sources.map((source) => (
              <div
                className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-muted"
                key={source.id}
              >
                {source.status === "active" ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <CircleAlert className="size-4 text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{source.display_name}</span>
                {source.status !== "disabled" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === source.id}
                    type="button"
                    onClick={() => onDisable(source)}
                  >
                    Disable
                  </Button>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </div>
            ))}
            {!sources.length ? (
              <p className="text-xs text-muted-foreground">No calendars published yet.</p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskProperty({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EventFact({ icon: Icon, value }: { icon: typeof Clock3; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{value}</span>
    </div>
  );
}

function formatEventDate(value: string, allDay: boolean) {
  const date = new Date(value);
  return date.toLocaleString(
    [],
    allDay
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}
