import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { TaskDraft } from "@/api/spaces/dto/types/SpaceTaskPrimitives";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@/shared/ui";
import { useSurfacePresentation } from "@/shared/mobile";
import { Check, Copy, LoaderCircle, MoreHorizontal, Trash2 } from "lucide-react";
import {
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { TaskMarkdownEditor } from "../components/TaskMarkdownEditor";
import { TaskDrawerProperties } from "./TaskDrawerProperties";

export interface SpaceTaskDrawerProps {
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
  const mobile = useSurfacePresentation() !== "desktop";
  const { draft, setDraft, editing, busy, canManage, onClose } = props;
  const [copiedKey, setCopiedKey] = useState(false);

  const hasProvenance = Boolean(
    editing && (editing.created_by_agent_id || editing.source_run_id || editing.source_refs.length),
  );

  const copyTaskKey = () => {
    if (!editing?.task_key) return;
    void navigator.clipboard.writeText(editing.task_key);
    setCopiedKey(true);
    window.setTimeout(() => setCopiedKey(false), 2000);
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
          mobile
            ? "inset-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0"
            : "flex h-[min(880px,82vh)] w-[min(1200px,82vw)] min-h-[540px] max-w-[85vw]",
          "flex-col gap-0 overflow-hidden rounded-2xl border border-charcoal-border",
          "bg-charcoal-card p-0 shadow-2xl",
          mobile && "rounded-none border-0 pt-[env(safe-area-inset-top)]",
        )}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={props.onSave}
          onKeyDown={handleFormKeyDown}
        >
          <DialogTitle className="sr-only">
            {editing ? `Edit ${editing.title}` : "Create task"}
          </DialogTitle>

          {/* Main Body */}
          <div
            className={cn(
              "grid min-h-0 flex-1 overflow-hidden",
              mobile
                ? "grid-cols-1 overflow-y-auto"
                : "grid-cols-[minmax(0,1fr)_280px] max-sm:grid-cols-1",
            )}
          >
            {/* Left Content Area */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col space-y-6 overflow-y-auto",
                mobile ? "p-4" : "p-7",
              )}
            >
              {/* Title input */}
              <div className="flex items-center gap-2 max-sm:pr-10">
                <Input
                  id="space-task-title"
                  autoFocus
                  className={cn(
                    "h-11 min-w-0 flex-1 rounded-lg border border-charcoal-border bg-charcoal-workspace/55",
                    "px-3 text-lg font-semibold leading-snug text-cream shadow-none",
                    "placeholder:text-cream-faint/40 focus-visible:border-sage-fg/70 focus-visible:ring-2 focus-visible:ring-sage-fg/15",
                  )}
                  maxLength={240}
                  required
                  placeholder="Task title..."
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  aria-label="Title"
                />
                {editing ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        type="button"
                        className={cn(
                          "shrink-0 text-cream-muted hover:text-cream",
                          mobile ? "size-11" : "size-9",
                        )}
                        aria-label="Task actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={copyTaskKey}>
                        {copiedKey ? (
                          <Check className="mr-2 size-4 text-status-green" />
                        ) : (
                          <Copy className="mr-2 size-4" />
                        )}
                        {copiedKey ? "Task ID copied" : `Copy task ID (${editing.task_key})`}
                      </DropdownMenuItem>
                      {props.onArchive ? (
                        <DropdownMenuItem
                          disabled={busy}
                          className="text-cream-bright focus:text-cream-bright"
                          onSelect={props.onArchive}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete task
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
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
              mobile && "pb-[max(0.875rem,env(safe-area-inset-bottom))]",
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
              <Button
                variant="ghost"
                size="sm"
                className={cn(mobile && "min-h-11")}
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || !canManage || !draft.title.trim()}
                type="submit"
                className={cn("px-4", mobile && "min-h-11")}
              >
                {busy ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
                {editing ? "Save changes" : "Create task"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
