import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { useExplorerStore } from "@/stores/explorer";
import type { ExplorerNotification } from "@/stores/explorer";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceInboxItem } from "@/models/interfaces/features/spaces/types";
import { activityButtonClass, activityEntryBaseClass, activityPanelClass, activityPopoverClass } from "./styles";
import { formatBadgeCount } from "./helpers";

export function ActivityPopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 84, top: 12 });
  const [tab, setTab] = useState<"unreads" | "mentions">("unreads");
  const navigate = useNavigate();
  const { history, clearHistory, markRead } = useExplorerStore(
    useShallow((state) => ({
      history: state.notificationHistory,
      clearHistory: state.clearNotificationHistory,
      markRead: state.markNotificationsRead,
    })),
  );
  const { inbox, loadInbox, markInboxSeen, clearInbox } = useSpacesStore(
    useShallow((state) => ({
      inbox: state.inbox,
      loadInbox: state.loadInbox,
      markInboxSeen: state.markInboxSeen,
      clearInbox: state.clearInbox,
    })),
  );
  const localEntries = tab === "unreads" ? [...history].reverse() : [];
  const cloudEntries = inbox[tab];
  const hasEntries = localEntries.length + cloudEntries.length > 0;
  useEffect(() => {
    if (!props.open) return;
    markRead();
    void markInboxSeen().then(loadInbox);
  }, [loadInbox, markInboxSeen, markRead, props.open]);
  useEffect(() => {
    if (!props.open) return;
    const syncPosition = () => {
      const rect = props.anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 420;
      const panelHeight = Math.min(460, window.innerHeight - 24);
      const left = Math.min(window.innerWidth - panelWidth - 12, rect.right + 10);
      const top = Math.min(
        Math.max(12, rect.top + rect.height / 2 - panelHeight / 2),
        window.innerHeight - panelHeight - 12,
      );
      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };
    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [props.anchorRef, props.open]);
  useEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target && props.anchorRef.current?.contains(target)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.anchorRef, props.onClose, props.open]);
  if (!props.open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={activityPopoverClass}
      style={{ left: position.left, top: position.top }}
    >
      <section className={activityPanelClass} role="dialog" aria-label="Activity">
        <header className="flex items-center justify-between gap-3.5 border-b border-[#333944] p-4">
          <h2 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">Activity</h2>
          <Button
            className={activityButtonClass}
            type="button"
            onClick={() => {
              if (tab === "unreads") clearHistory();
              void clearInbox(tab);
            }}
            disabled={!hasEntries}
            aria-label="Clear all activity"
            title="Clear all activity"
          >
            <CheckCheck size={19} strokeWidth={2} />
          </Button>
        </header>
        <div className="grid grid-cols-2 border-b border-[#333944] px-4">
          {(["unreads", "mentions"] as const).map((item) => (
            <Button
              className={`relative h-10 border-0 bg-transparent text-xs font-semibold capitalize ${tab === item ? "text-[#f1eee8] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet-400" : "text-[#9e9890]"}`}
              type="button"
              key={item}
              onClick={() => setTab(item)}
            >
              {item}
              {inbox[item].length > 0 ? (
                <span className="ml-1.5 rounded-full bg-[#252832] px-1.5 py-0.5 text-[9px]">
                  {formatBadgeCount(inbox[item].length)}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        {hasEntries ? (
          <div className="min-h-0 overflow-auto px-4 py-3">
            {cloudEntries.length > 0 ? (
              <p className="mb-1 mt-0 px-2 text-[9px] font-semibold capitalize text-[#77736d]">
                Spaces
              </p>
            ) : null}
            {cloudEntries.map((entry) => (
              <CloudActivityEntry
                key={entry.id}
                entry={entry}
                onOpen={() => {
                  navigate(
                    `/spaces/${encodeURIComponent(entry.space_id)}/chat${entry.message_id ? `?message=${encodeURIComponent(entry.message_id)}` : ""}`,
                  );
                  props.onClose();
                }}
              />
            ))}
            {localEntries.length > 0 && cloudEntries.length > 0 ? (
              <p className="mb-1 mt-4 px-2 text-[9px] font-semibold capitalize text-[#77736d]">
                This Device
              </p>
            ) : null}
            {localEntries.map((entry) => (
              <ActivityEntry key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="grid content-center justify-items-center gap-2 text-center text-[#9e9890]">
            <h3 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">
              {tab === "mentions" ? "No mentions" : "You’re all caught up"}
            </h3>
            <p className="mt-1.5 text-[#9e9890]">
              {tab === "mentions"
                ? "Direct mentions, Agent replies, and approvals will appear here."
                : "New Space messages and local file activity will appear here."}
            </p>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function CloudActivityEntry(props: { entry: SpaceInboxItem; onOpen: () => void }) {
  const fallback =
    props.entry.kind === "mention"
      ? `You were mentioned in ${props.entry.space_name}`
      : props.entry.kind === "agent"
        ? `Agent activity in ${props.entry.space_name}`
        : props.entry.kind === "workflow"
          ? `Workflow activity in ${props.entry.space_name}`
          : `New message in ${props.entry.space_name}`;
  const sender =
    typeof props.entry.payload.sender_name === "string" ? props.entry.payload.sender_name : "";
  const preview =
    typeof props.entry.payload.preview === "string" ? props.entry.payload.preview : "";
  const label = preview ? `${sender ? `${sender}: ` : ""}${preview}` : fallback;
  return (
    <Button
      className={`${activityEntryBaseClass} grid w-full border-0 bg-transparent text-left [&+&]:mt-1`}
      type="button"
      onClick={props.onOpen}
    >
      <span className="m-0 min-w-0 [overflow-wrap:anywhere] leading-[1.35] text-[#f1eee8]">
        <small className="mb-0.5 block text-[10px] font-semibold text-violet-300">
          {props.entry.space_name}
        </small>
        {label}
      </span>
      <time className="whitespace-nowrap pt-px text-xs text-[#9e9890]">
        {formatActivityTime(new Date(props.entry.created_at).getTime())}
      </time>
    </Button>
  );
}

function ActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article
      className={`${activityEntryBaseClass} ${props.entry.read ? "" : "bg-[rgba(241,238,232,0.035)]"} [&+&]:mt-1`}
    >
      <p className="m-0 min-w-0 [overflow-wrap:anywhere] leading-[1.35] text-[#f1eee8]">
        {props.entry.message}
      </p>
      <time className="whitespace-nowrap pt-px text-xs text-[#9e9890]">
        {formatActivityTime(props.entry.createdAtMs)}
      </time>
    </article>
  );
}

function formatActivityTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
