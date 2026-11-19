import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  ListRow,
  ListRowSkeleton,
  useNotice,
} from "@/shared/ui";
import { useEffect, useState, type ReactNode } from "react";
import { historyApi, type HistoryKind, type HistoryVersion } from "./historyApi";
import { HistoryPreview, HistoryPreviewSkeleton } from "./HistoryPreview";

export interface HistoryDialogProps {
  spaceId: string;
  kind: HistoryKind;
  itemId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Told once a version is restored, after the dialog closes. */
  onRestored?(version: HistoryVersion): void;
}

type Loaded<T> = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; value: T };

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A version's time as its row shows it. */
export function versionTimeLabel(createdAt: string): string {
  const at = new Date(createdAt);
  return Number.isNaN(at.getTime()) ? createdAt : timeFormat.format(at);
}

function versionSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The kept versions, read each time the dialog opens. */
function useVersions(spaceId: string, kind: HistoryKind, itemId: string, open: boolean) {
  const [versions, setVersions] = useState<Loaded<HistoryVersion[]>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setVersions({ phase: "loading" });
    historyApi
      .list(spaceId, kind, itemId)
      .then((value) => {
        if (active) setVersions({ phase: "ready", value });
      })
      .catch(() => {
        if (active) setVersions({ phase: "failed" });
      });
    return () => {
      active = false;
    };
  }, [spaceId, kind, itemId, open, attempt]);
  return { versions, retry: () => setAttempt((value) => value + 1) };
}

/** One version's content, fetched when it is picked. */
function useVersionUpdate(
  spaceId: string,
  kind: HistoryKind,
  itemId: string,
  versionId: string | null,
) {
  const [update, setUpdate] = useState<Loaded<Uint8Array>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!versionId) return;
    let active = true;
    setUpdate({ phase: "loading" });
    historyApi
      .get(spaceId, kind, itemId, versionId)
      .then((value) => {
        if (active) setUpdate({ phase: "ready", value });
      })
      .catch(() => {
        if (active) setUpdate({ phase: "failed" });
      });
    return () => {
      active = false;
    };
  }, [spaceId, kind, itemId, versionId, attempt]);
  return { update, retry: () => setAttempt((value) => value + 1) };
}

/**
 * An item's version history from its ⋯ menu: the kept versions by time, the picked one read-only,
 * and Restore, which puts the item back to it as a new revision for everyone.
 */
export function HistoryDialog(props: HistoryDialogProps) {
  const { versions, retry: retryVersions } = useVersions(
    props.spaceId,
    props.kind,
    props.itemId,
    props.open,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const list = versions.phase === "ready" ? versions.value : [];
  const current = list.find((version) => version.id === picked) ?? list[0] ?? null;
  const { update, retry: retryUpdate } = useVersionUpdate(
    props.spaceId,
    props.kind,
    props.itemId,
    props.open ? (current?.id ?? null) : null,
  );
  useNotice(restoreFailed, {
    message: "The version couldn’t be restored. Try again.",
    tone: "error",
    onDismiss: () => setRestoreFailed(false),
  });

  useEffect(() => {
    if (props.open) return;
    setPicked(null);
    setRestoring(false);
    setRestoreFailed(false);
  }, [props.open]);

  const restore = async () => {
    if (!current || restoring) return;
    setRestoring(true);
    setRestoreFailed(false);
    try {
      await historyApi.restore(props.spaceId, props.kind, props.itemId, current.id);
      props.onOpenChange(false);
      props.onRestored?.(current);
    } catch {
      setRestoreFailed(true);
    } finally {
      setRestoring(false);
    }
  };

  let body: ReactNode;
  if (versions.phase === "loading") {
    body = (
      <div className="grid grid-cols-3 gap-4">
        <ListRowSkeleton label="Loading versions" rows={6} lines={2} />
        <div className="col-span-2">
          <HistoryPreviewSkeleton kind={props.kind} />
        </div>
      </div>
    );
  } else if (versions.phase === "failed") {
    body = (
      <ErrorState
        inline
        title="Versions couldn’t load"
        action={{ label: "Try again", variant: "secondary", onClick: retryVersions }}
      />
    );
  } else if (!list.length) {
    body = (
      <EmptyState inline title="No versions yet" line="Versions are kept as the item changes." />
    );
  } else {
    body = (
      <div className="grid h-96 grid-cols-3 gap-4">
        <div className="misty-scrollbar min-h-0 overflow-y-auto">
          {list.map((version) => (
            <ListRow
              key={version.id}
              label={versionTimeLabel(version.created_at)}
              description={versionSize(version.content_bytes) || undefined}
              selected={version.id === current?.id}
              onOpen={() => setPicked(version.id)}
            />
          ))}
        </div>
        <div
          className="misty-scrollbar col-span-2 min-h-0 overflow-y-auto"
          aria-label="Version preview"
        >
          {update.phase === "loading" ? (
            <HistoryPreviewSkeleton kind={props.kind} />
          ) : update.phase === "failed" ? (
            <ErrorState
              inline
              title="This version couldn’t load"
              action={{ label: "Try again", variant: "secondary", onClick: retryUpdate }}
            />
          ) : (
            <HistoryPreview
              spaceId={props.spaceId}
              kind={props.kind}
              itemId={props.itemId}
              update={update.value}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!restoring) props.onOpenChange(open);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>
        <DialogBody>{body}</DialogBody>
        <DialogFooter>
          <Button
            type="button"
            size="lg"
            variant="quiet"
            disabled={restoring}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!current || restoring || update.phase !== "ready"}
            onClick={() => void restore()}
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
