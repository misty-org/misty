import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Archive, Check, LoaderCircle, MoreHorizontal } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@/ui";
import { TaskCalendarNotice } from "@/features/spaces/components/TaskCalendarNotice";
import type { SpaceMember, SpaceTask } from "@/models/interfaces/features/spaces/types";
import type { TaskDraft } from "@/models/types/features/spaces/SpaceTaskPrimitives";
import { TaskDrawerProperties } from "./TaskDrawerProperties";

export interface SpaceTaskDrawerProps {
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
}

export function SpaceTaskDrawer(props: SpaceTaskDrawerProps) {
  const { draft, setDraft, editing, busy, canManage, onClose } = props;
  const hasProvenance = Boolean(
    editing && (editing.created_by_agent_id || editing.source_run_id || editing.source_refs.length),
  );

  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="flex w-[min(600px,96vw)] max-w-none flex-col gap-0 bg-background p-0 sm:max-w-none">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={props.onSave}>
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
              {props.onArchive ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" type="button" aria-label="Task actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={props.onArchive}
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
              {hasProvenance && editing ? <TaskProvenance task={editing} /> : null}
            </div>

            <TaskDrawerProperties
              draft={draft}
              setDraft={setDraft}
              members={props.members}
              canManage={canManage}
            />
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

function TaskProvenance({ task }: { task: SpaceTask }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Provenance</summary>
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
