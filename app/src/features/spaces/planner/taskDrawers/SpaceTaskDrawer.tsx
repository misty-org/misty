import { MistyPicker } from "@/features/picker";
import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
  SpaceTaskActivity,
  SpaceTaskSourceRef,
} from "@/api/spaces/dto/interfaces/types";
import type { TaskDraft } from "@/api/spaces/dto/types/SpaceTaskPrimitives";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Textarea,
} from "@/shared/ui";
import {
  Archive,
  Bot,
  Check,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { TaskCalendarNotice } from "../components/TaskCalendarNotice";
import { TaskDrawerProperties } from "./TaskDrawerProperties";

export interface SpaceTaskDrawerProps {
  spaceId: string;
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>> | ((draft: TaskDraft) => void);
  editing: SpaceTask | null;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  busy: boolean;
  canManage: boolean;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  onArchive?: () => void;
  /** Sends this task's schedule edits to Google. Omitted for Misty-only tasks. */
  onPublishCalendar?: () => void;
  /** Drops local schedule edits in favour of what Google holds. */
  onDiscardCalendar?: () => void;
}

export function SpaceTaskDrawer(props: SpaceTaskDrawerProps) {
  const { draft, setDraft, editing, busy, canManage, onClose } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [activity, setActivity] = useState<SpaceTaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const hasProvenance = Boolean(
    editing && (editing.created_by_agent_id || editing.source_run_id || editing.source_refs.length),
  );

  useEffect(() => {
    if (!editing) {
      setActivity([]);
      return;
    }
    let current = true;
    setActivityLoading(true);
    const loadActivity = async () => {
      try {
        const result = await spacesApi.taskActivity(props.spaceId, editing.id);
        if (current) setActivity(result.activity);
      } catch {
        if (current) setActivity([]);
      } finally {
        if (current) setActivityLoading(false);
      }
    };
    void loadActivity();
    const poll = window.setInterval(() => void loadActivity(), 6000);
    return () => {
      current = false;
      window.clearInterval(poll);
    };
  }, [editing, props.spaceId]);

  const replaceLibraryRefs = (itemIds: string[]) => {
    const retained = draft.source_refs.filter((ref) => ref.kind !== "library_item");
    setDraft({
      ...draft,
      source_refs: [
        ...retained,
        ...itemIds.map((resourceId): SpaceTaskSourceRef => ({
          kind: "library_item",
          resource_id: resourceId,
          display_name: "Library item",
        })),
      ],
    });
  };

  const uploadTaskAttachments = async (paths: string[]) => {
    if (!canManage || paths.length === 0) return;
    setAttachmentUploading(true);
    try {
      const refs: SpaceTaskSourceRef[] = [];
      for (const path of paths.slice(0, Math.max(0, 20 - draft.source_refs.length))) {
        const result = await spacesApi.uploadLibraryPath(props.spaceId, path, "attachment");
        if (result.attachment) {
          refs.push({
            kind: "task_attachment",
            resource_id: result.attachment.id,
            display_name: result.attachment.display_name,
          });
        }
      }
      if (refs.length) setDraft({ ...draft, source_refs: [...draft.source_refs, ...refs] });
    } finally {
      setAttachmentUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className={[
          "flex h-[min(760px,calc(100vh-56px))] w-[min(680px,calc(100vw-40px))]",
          "max-w-none flex-col gap-0 overflow-hidden bg-charcoal-card p-0",
        ].join(" ")}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={props.onSave}>
          <DialogHeader className="border-b border-charcoal-border/60 px-5 py-4 pr-14 text-left">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle>{editing ? editing.task_key : "New task"}</DialogTitle>
                <DialogDescription>
                  {editing
                    ? "Update the task details and assignment."
                    : "Create a shared task for this Space."}
                </DialogDescription>
              </div>
              {props.onArchive ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" type="button" aria-label="Task actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-cream-bright focus:text-cream-bright"
                      onSelect={props.onArchive}
                    >
                      <Archive className="mr-2 size-4" />
                      Archive task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px] overflow-auto max-sm:grid-cols-1">
            <div className="grid content-start gap-5 p-5 sm:p-6">
              {editing && props.onPublishCalendar && props.onDiscardCalendar ? (
                <TaskCalendarNotice
                  task={editing}
                  busy={busy}
                  canManage={canManage}
                  onPublish={props.onPublishCalendar}
                  onDiscard={props.onDiscardCalendar}
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
              <TaskSources
                refs={draft.source_refs}
                disabled={!canManage || attachmentUploading}
                uploading={attachmentUploading}
                onAdd={() => setPickerOpen(true)}
                onRemove={(resourceId) =>
                  setDraft({
                    ...draft,
                    source_refs: draft.source_refs.filter((ref) => ref.resource_id !== resourceId),
                  })
                }
              />
              {editing ? (
                <TaskActivity
                  activity={activity}
                  loading={activityLoading}
                  agents={props.agents}
                  members={props.members}
                />
              ) : null}
              {hasProvenance && editing ? <TaskProvenance task={editing} /> : null}
            </div>

            <TaskDrawerProperties
              draft={draft}
              setDraft={setDraft}
              members={props.members}
              agents={props.agents}
              canManage={canManage}
            />
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-charcoal-border/60 px-5 py-4">
            <Button variant="outline" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || attachmentUploading || !canManage || !draft.title.trim()}
              type="submit"
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {pickerOpen ? (
        <MistyPicker
          spaceId={props.spaceId}
          initialSource="files"
          multiple
          title="Attach context to this task"
          librarySelectedIds={draft.source_refs
            .filter((ref) => ref.kind === "library_item")
            .map((ref) => ref.resource_id)}
          libraryMaximum={20}
          onCancel={() => setPickerOpen(false)}
          onChooseFiles={(paths) => {
            setPickerOpen(false);
            void uploadTaskAttachments(paths);
          }}
          onChooseLibraryItems={(ids) => {
            replaceLibraryRefs(ids);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function TaskSources({
  refs,
  disabled,
  uploading,
  onAdd,
  onRemove,
}: {
  refs: SpaceTaskSourceRef[];
  disabled: boolean;
  uploading: boolean;
  onAdd: () => void;
  onRemove: (resourceId: string) => void;
}) {
  return (
    <section className="grid gap-2" aria-label="Task file context">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="m-0 text-sm font-medium">File context</p>
          <p className="mb-0 mt-0.5 text-xs text-cream-muted">
            Agents can read only items explicitly attached here.
          </p>
        </div>
        <Button size="sm" variant="outline" type="button" disabled={disabled} onClick={onAdd}>
          {uploading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
          Attach
        </Button>
      </div>
      {refs.length ? (
        <div className="grid gap-1.5">
          {refs.map((ref) => (
            <div
              key={`${ref.kind}:${ref.resource_id}`}
              className="flex items-center gap-2 rounded-md border border-charcoal-border/70 px-2.5 py-2"
            >
              <FileText className="size-4 shrink-0 text-cream-muted" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {ref.display_name || ref.resource_id}
              </span>
              <span className="text-[10px] text-cream-muted">
                {ref.kind === "library_item" ? "Library link" : "Task attachment"}
              </span>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                className="size-7"
                disabled={disabled}
                aria-label={`Remove ${ref.display_name || "attachment"}`}
                onClick={() => onRemove(ref.resource_id)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TaskActivity({
  activity,
  loading,
  agents,
  members,
}: {
  activity: SpaceTaskActivity[];
  loading: boolean;
  agents: SpaceAgentMembership[];
  members: SpaceMember[];
}) {
  return (
    <section className="grid gap-2" aria-label="Task activity">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-cream-muted" />
        <p className="m-0 text-sm font-medium">Activity</p>
      </div>
      {loading ? (
        <p className="m-0 text-xs text-cream-muted">Loading activity…</p>
      ) : activity.length ? (
        <div className="grid gap-2 border-l border-charcoal-border pl-3">
          {activity.map((item) => {
            const actor =
              item.actor_kind === "agent"
                ? agents.find((agent) => agent.agent_id === item.actor_agent_id)?.name || "Agent"
                : item.actor_kind === "person"
                  ? members.find((member) => member.user_id === item.actor_user_id)?.name ||
                    "Member"
                  : "Misty";
            const warning =
              typeof item.metadata?.file_warnings === "string"
                ? item.metadata.file_warnings.trim()
                : "";
            return (
              <div key={item.id} className="grid gap-0.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{actor}</span>
                  <span className="capitalize text-cream-muted">{item.kind}</span>
                </div>
                {item.message ? <p className="m-0 whitespace-pre-wrap">{item.message}</p> : null}
                {warning ? (
                  <p className="m-0 whitespace-pre-wrap rounded bg-sage-bg p-2 text-sage-fg">
                    {warning}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-xs text-cream-muted">No Agent activity yet.</p>
      )}
    </section>
  );
}

function TaskProvenance({ task }: { task: SpaceTask }) {
  return (
    <div className="rounded-lg bg-charcoal-card p-3">
      <details className="text-xs text-cream-muted">
        <summary className="cursor-pointer font-medium text-cream">Provenance</summary>
        <div className="mt-2 grid gap-1">
          {task.created_by_agent_id ? <span>Generated task</span> : null}
          <span>
            {task.source_refs.length} source{task.source_refs.length === 1 ? "" : "s"}
          </span>
        </div>
      </details>
    </div>
  );
}
