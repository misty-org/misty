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
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@/shared/ui";
import {
  Archive,
  Bot,
  Check,
  Copy,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { TaskMarkdownEditor } from "../components/TaskMarkdownEditor";
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
}

export function SpaceTaskDrawer(props: SpaceTaskDrawerProps) {
  const { draft, setDraft, editing, busy, canManage, onClose } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [activity, setActivity] = useState<SpaceTaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

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

  const copyTaskKey = () => {
    if (!editing?.task_key) return;
    void navigator.clipboard.writeText(editing.task_key);
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 2000);
  };

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

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (draft.title.trim() && !busy && canManage) {
        event.preventDefault();
        props.onSave(event as unknown as FormEvent);
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className={cn(
          "flex h-[min(880px,82vh)] w-[min(1200px,82vw)] min-h-[540px] max-w-[85vw]",
          "flex-col gap-0 overflow-hidden rounded-2xl border border-charcoal-border",
          "bg-charcoal-card p-0 shadow-2xl",
        )}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={props.onSave}
          onKeyDown={handleFormKeyDown}
        >
          {/* Header */}
          <DialogHeader
            className={cn(
              "flex flex-row items-center justify-between border-b border-charcoal-border/70",
              "px-7 py-3.5 pr-14 text-left",
            )}
          >
            <div className="flex items-center gap-2.5">
              {editing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={copyTaskKey}
                  title="Click to copy task ID"
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs font-semibold tracking-wide transition-colors",
                    "bg-charcoal-workspace text-cream hover:bg-charcoal-hover",
                  )}
                >
                  <span>{editing.task_key}</span>
                  {copiedKey ? (
                    <Check className="size-3 text-status-green" />
                  ) : (
                    <Copy className="size-3 text-cream-muted" />
                  )}
                </Button>
              ) : (
                <span className="rounded-md bg-charcoal-workspace px-2 py-0.5 text-xs font-semibold tracking-wide text-cream-bright">
                  New task
                </span>
              )}
            </div>

            {props.onArchive ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    className="size-7 text-cream-muted hover:text-cream"
                    aria-label="Task actions"
                  >
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
          </DialogHeader>

          {/* Main Body */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] overflow-hidden max-sm:grid-cols-1">
            {/* Left Content Area */}
            <div className="flex min-h-0 flex-1 flex-col space-y-6 overflow-y-auto p-7">
              {/* Title input */}
              <div className="grid gap-1">
                <Input
                  id="space-task-title"
                  autoFocus
                  className={cn(
                    "h-auto w-full border-0 bg-transparent p-0 text-xl font-semibold leading-snug",
                    "text-cream shadow-none placeholder:text-cream-faint/30 focus-visible:ring-0",
                  )}
                  maxLength={240}
                  required
                  placeholder="Task title..."
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  aria-label="Title"
                />
              </div>

              {/* Notes / Markdown Editor */}
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-cream-muted">Notes & Description</label>
                <TaskMarkdownEditor
                  placeholder="Add notes"
                  value={draft.notes}
                  onChange={(val) => setDraft({ ...draft, notes: val })}
                  disabled={!canManage}
                  minHeight={240}
                />
              </div>

              {/* File context */}
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

              {/* Activity log */}
              {editing ? (
                <TaskActivity
                  activity={activity}
                  loading={activityLoading}
                  agents={props.agents}
                  members={props.members}
                />
              ) : null}

              {/* Provenance */}
              {hasProvenance && editing ? <TaskProvenance task={editing} /> : null}
            </div>

            {/* Right Properties Sidebar */}
            <TaskDrawerProperties
              draft={draft}
              setDraft={setDraft}
              members={props.members}
              agents={props.agents}
              canManage={canManage}
            />
          </div>

          {/* Footer */}
          <DialogFooter
            className={cn(
              "flex-row items-center justify-between border-t border-charcoal-border/70",
              "bg-charcoal-card/40 px-6 py-3.5",
            )}
          >
            <div className="hidden text-[11px] text-cream-faint sm:block">
              Press{" "}
              <kbd className="rounded bg-charcoal-workspace px-1 py-0.5 font-mono text-[10px] text-cream">
                ⌘ Enter
              </kbd>{" "}
              to save
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || attachmentUploading || !canManage || !draft.title.trim()}
                type="submit"
                className="px-4"
              >
                {busy ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
                {editing ? "Save changes" : "Create task"}
              </Button>
            </div>
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
          <p className="m-0 text-xs font-medium text-cream">Attached context</p>
          <p className="mb-0 mt-0.5 text-[11px] text-cream-muted">
            Files and library links accessible to AI agents working on this task.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="h-7 gap-1.5 text-xs"
        >
          {uploading ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Paperclip className="size-3" />
          )}
          Attach
        </Button>
      </div>
      {refs.length ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {refs.map((ref) => (
            <div
              key={`${ref.kind}:${ref.resource_id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-charcoal-border/70",
                "bg-charcoal-workspace/50 px-2.5 py-1.5 text-xs text-cream",
              )}
            >
              <FileText className="size-3.5 shrink-0 text-cream-muted" />
              <span className="min-w-0 flex-1 truncate">{ref.display_name || ref.resource_id}</span>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                className="size-5 rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
                disabled={disabled}
                aria-label={`Remove ${ref.display_name || "attachment"}`}
                onClick={() => onRemove(ref.resource_id)}
              >
                <X className="size-3" />
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
    <section
      className="grid gap-2 border-t border-charcoal-border/50 pt-2"
      aria-label="Task activity"
    >
      <div className="flex items-center gap-2">
        <Bot className="size-3.5 text-cream-muted" />
        <p className="m-0 text-xs font-medium text-cream">Activity & Run History</p>
      </div>
      {loading ? (
        <p className="m-0 text-xs text-cream-muted">Loading activity…</p>
      ) : activity.length ? (
        <div className="grid gap-2 border-l border-charcoal-border/70 pl-3">
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
                  <span className="font-medium text-cream-bright">{actor}</span>
                  <span className="text-[10px] capitalize text-cream-muted">{item.kind}</span>
                </div>
                {item.message ? (
                  <p className="m-0 whitespace-pre-wrap text-cream/90">{item.message}</p>
                ) : null}
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
    <div className="rounded-lg border border-charcoal-border/50 bg-charcoal-workspace/40 p-3">
      <details className="text-xs text-cream-muted">
        <summary className="cursor-pointer font-medium text-cream">Provenance metadata</summary>
        <div className="mt-2 grid gap-1 text-[11px]">
          {task.created_by_agent_id ? (
            <span>Generated by Agent: {task.created_by_agent_id}</span>
          ) : null}
          <span>
            {task.source_refs.length} attached source{task.source_refs.length === 1 ? "" : "s"}
          </span>
        </div>
      </details>
    </div>
  );
}
