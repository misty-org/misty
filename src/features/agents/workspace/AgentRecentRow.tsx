import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import { usePointerDrag } from "@/shared/hooks/usePointerReorder";
import { Button, ContextMenu, ContextMenuTrigger, Skeleton } from "@/shared/ui";
import { useTitlePending } from "@/features/misty/conversationTitles";
import { useConversationActions } from "../components/useConversationActions";
import { RecentStatusBadge, type RecentStatus } from "./RecentStatusBadge";

/**
 * One conversation in the sidebar. Dragging it onto a folder or Recents files it there;
 * a selected row carries the whole selection. Alt+Shift+Up/Down moves it one place.
 * Right-click opens the same actions as its overflow menu.
 */
export function AgentRecentRow({
  conversation,
  scope,
  dragIds,
  status,
  active,
  selected,
  selecting,
  disabled,
  onClick,
  onMove,
}: {
  conversation: { id: string; title?: string };
  scope: string;
  /** What a drag from this row carries: the selection when this row is in it. */
  dragIds: string[];
  status?: RecentStatus;
  active: boolean;
  selected: boolean;
  selecting: boolean;
  disabled: boolean;
  onClick(event: MouseEvent): void;
  onMove(direction: -1 | 1): void;
}) {
  const titlePending = useTitlePending(conversation);
  // Fade the name in only when it replaces the skeleton, not on every mount.
  const wasPending = useRef(false);
  const revealed = wasPending.current && !titlePending;
  wasPending.current = titlePending;
  const name = titlePending ? "New conversation" : conversation.title || "Untitled conversation";
  const drag = usePointerDrag({
    id: conversation.id,
    ids: dragIds,
    label: dragIds.length > 1 ? `${dragIds.length} conversations` : name,
    scope,
  });
  const actions = useConversationActions({ conversation, disabled });
  const keyDown = (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    onMove(direction);
  };
  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild disabled={disabled}>
          <div
            className="agent-studio-recent-row"
            data-current={active || undefined}
            data-reorder-preview="true"
            data-selected={selected || undefined}
          >
            <Button
              data-agent-navigation-control
              data-reorder-handle={disabled ? undefined : "true"}
              variant="ghost"
              justify="start"
              disabled={disabled}
              title={name}
              aria-current={active ? "page" : undefined}
              aria-pressed={selecting ? selected : undefined}
              aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
              onPointerDown={disabled ? undefined : drag}
              onKeyDown={keyDown}
              onClick={onClick}
            >
              <RecentStatusBadge status={status} />
              {titlePending ? (
                <span className="agent-studio-recent-title" aria-busy="true">
                  <Skeleton className="agent-title-skeleton" />
                  <span className="sr-only">{name}</span>
                </span>
              ) : (
                <span
                  className={`agent-studio-recent-title${revealed ? " agent-title-reveal" : ""}`}
                >
                  {name}
                </span>
              )}
            </Button>
            {actions.dropdown}
          </div>
        </ContextMenuTrigger>
        {actions.contextMenu}
      </ContextMenu>
      {actions.dialogs}
    </>
  );
}
