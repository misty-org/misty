import { Button } from "../../../components/ui/button";
import type {
  ExplorerInlineEditState,
  ExplorerNotification,
} from "../../../stores/useExplorerStore";
import { cx } from "./ExplorerDesktopShared";

export function ExplorerRenameStatus(props: { edit: ExplorerInlineEditState | null }) {
  if (!props.edit || props.edit.error || props.edit.batchItems?.some((item) => item.error))
    return null;
  const summary = renameStatusSummary(props.edit);
  return (
    <div
      className={cx(
        renameStatusStyles.root,
        summary.tone === "warning" && renameStatusStyles.warning,
      )}
      role="status"
      aria-live="polite"
    >
      <span className={renameStatusStyles.text}>{summary.text}</span>
    </div>
  );
}

function renameStatusSummary(edit: ExplorerInlineEditState): {
  text: string;
  tone: "ready" | "warning";
} {
  if (edit.kind === "create") {
    if (edit.error) {
      return { text: `Create mode: ${edit.error}`, tone: "warning" };
    }
    return { text: "Create mode: Press Enter to create", tone: "ready" };
  }

  const batchItems =
    edit.batchItems && edit.batchItems.length > 1
      ? edit.batchItems
      : [
          {
            originalName: edit.originalName,
            value: edit.value,
            lockedExtension: edit.lockedExtension,
            error: edit.error,
          },
        ];
  let ready = 0;
  let unchanged = 0;
  let invalid = 0;
  for (const item of batchItems) {
    if (item.error) {
      invalid += 1;
      continue;
    }
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    if (effectiveName === item.originalName) unchanged += 1;
    else ready += 1;
  }

  if (invalid === 0) {
    return {
      text: `Rename mode: Press Enter to review ${ready} ${ready === 1 ? "item" : "items"}`,
      tone: "ready",
    };
  }
  return {
    text: `Rename mode: ${ready} ready, ${unchanged} unchanged, ${invalid} need fixes`,
    tone: "warning",
  };
}

export function ExplorerNotifications(props: {
  notifications: ExplorerNotification[];
  onDismiss: (id: number) => void;
}) {
  if (props.notifications.length === 0) return null;
  return (
    <div className={notificationStyles.stack} aria-live="polite" aria-atomic="false">
      {props.notifications.map((notification) => (
        <Button
          key={notification.id}
          type="button"
          className={cx(
            notificationStyles.item,
            notification.type === "success" && notificationStyles.success,
            notification.type === "error" && notificationStyles.error,
            notification.type === "info" && notificationStyles.info,
          )}
          title={notification.message}
          onClick={() => props.onDismiss(notification.id)}
        >
          {compactNotificationMessage(notification.message)}
        </Button>
      ))}
    </div>
  );
}

function compactNotificationMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length <= 64 ? normalized : `${normalized.slice(0, 61)}...`;
}

const renameStatusStyles = {
  root: "pointer-events-none absolute bottom-[34px] left-1/2 z-[28] flex min-h-[30px] max-w-[min(520px,calc(100%_-_96px))] -translate-x-1/2 items-center justify-center rounded-lg bg-popover/95 px-3.5 py-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl",
  warning: "text-warning",
  text: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium",
} as const;

const notificationStyles = {
  stack:
    "pointer-events-none absolute left-1/2 top-3 z-30 grid w-[min(360px,calc(100%_-_48px))] -translate-x-1/2 justify-items-center gap-2",
  item: "pointer-events-auto min-h-8 max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-popover/95 px-[13px] py-[7px] text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl",
  success: "text-success",
  error: "text-destructive",
  info: "",
} as const;
