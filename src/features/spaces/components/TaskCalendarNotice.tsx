import type { ReactNode } from "react";
import { CalendarClock, CloudOff, TriangleAlert, Upload } from "lucide-react";

import { Button } from "@/ui";
import { taskSyncState } from "@/features/spaces/connections/googleCalendarMapping";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";

/**
 * The publish / discard / resolve surface for a calendar-backed task.
 *
 * Writing to Google Calendar is always something a person chose here. Misty
 * holds local edits until they press Publish, and when Google changed the same
 * field it asks which version wins instead of picking one.
 */
export function TaskCalendarNotice({
  task,
  busy,
  canManage,
  onPublish,
  onDiscard,
}: {
  task: SpaceTask;
  busy: boolean;
  canManage: boolean;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  const conflicted = Boolean(task.conflicted_fields?.length);
  const state = taskSyncState(task.schedule, task.calendar, { conflicted });
  if (!state || state === "synced") return null;

  if (state === "canceled_remotely") {
    return (
      <Notice tone="warning" icon={CloudOff} title="Canceled in Google Calendar">
        This event was canceled in Google. The task stays here so nothing is lost — archive it if
        the work is done with.
      </Notice>
    );
  }

  if (state === "sync_error") {
    return (
      <Notice tone="warning" icon={TriangleAlert} title="Sync problem">
        Misty could not reach this Google calendar. It will try again on the next sync.
      </Notice>
    );
  }

  if (state === "conflict") {
    return (
      <Notice tone="warning" icon={TriangleAlert} title="Google also changed this event">
        <p className="m-0">
          Your edits to <strong>{task.conflicted_fields?.join(", ")}</strong> have not been sent,
          and Google has a different version. Choose which one to keep.
        </p>
        <Actions
          busy={busy}
          canManage={canManage}
          publishLabel="Keep mine and publish"
          discardLabel="Use Google's version"
          onPublish={onPublish}
          onDiscard={onDiscard}
        />
      </Notice>
    );
  }

  return (
    <Notice
      tone="info"
      icon={state === "draft" ? CalendarClock : Upload}
      title={state === "draft" ? "Not on Google Calendar yet" : "Unpublished changes"}
    >
      <p className="m-0">
        {state === "draft"
          ? "This task is a local draft. Publishing creates the Google Calendar event."
          : "These schedule edits are only in Misty until you publish them."}
      </p>
      <Actions
        busy={busy}
        canManage={canManage}
        publishLabel={state === "draft" ? "Publish to Google Calendar" : "Publish changes"}
        discardLabel={state === "draft" ? undefined : "Discard changes"}
        onPublish={onPublish}
        onDiscard={onDiscard}
      />
    </Notice>
  );
}

function Actions({
  busy,
  canManage,
  publishLabel,
  discardLabel,
  onPublish,
  onDiscard,
}: {
  busy: boolean;
  canManage: boolean;
  publishLabel: string;
  discardLabel?: string;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" type="button" disabled={busy || !canManage} onClick={onPublish}>
        {publishLabel}
      </Button>
      {discardLabel ? (
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={busy || !canManage}
          onClick={onDiscard}
        >
          {discardLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "info" | "warning";
  icon: typeof CalendarClock;
  title: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === "warning" ? "border-sage-fg/30 bg-sage-bg" : "border-charcoal-border bg-charcoal-card";
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${toneClass}`} role="status">
      <p className="m-0 flex items-center gap-1.5 font-medium">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </p>
      <div className="mt-1 text-cream-muted">{children}</div>
    </div>
  );
}
