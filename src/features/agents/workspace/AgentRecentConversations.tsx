import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Trash2, X } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  IconButton,
  Spinner,
} from "@/shared/ui";
import { AgentConversationActions } from "../components/AgentConversationActions";
import {
  activityStateIcon,
  activityStateLabels,
  formatActivityTime,
} from "../page/useAgentActivity";

type Recent = { id: string; title?: string };
/** A conversation's latest run, for its row's status icon. */
export type RecentStatus = { state: string; updatedAt: string };

/**
 * A row shows its latest run only when it is worth a look: still going, or did not end
 * cleanly. Finished runs show nothing, so a quiet list means nothing needs attention.
 */
function RecentStatusIcon({ status }: { status?: RecentStatus }) {
  if (!status || status.state === "completed") return null;
  const Icon = activityStateIcon(status.state);
  const label = `${activityStateLabels[status.state] ?? status.state.replace(/_/g, " ")} · ${formatActivityTime(status.updatedAt)}`;
  return (
    <span className="agent-studio-recent-status" title={label}>
      {status.state === "running" ? (
        <Spinner size="sm" label={false} />
      ) : (
        <Icon size={14} aria-hidden="true" />
      )}
      <span className="sr-only">, {label}</span>
    </span>
  );
}

/**
 * The sidebar's recent conversations. Cmd/Ctrl-click toggles a row and
 * Shift-click selects a range, as in Finder; a plain click just opens it.
 */
/** Memoized: the open conversation's streaming updates must not re-render every row. */
export const AgentRecentConversations = memo(function AgentRecentConversations({
  recent,
  statuses,
  activeId,
  disabled,
  onConversation,
}: {
  recent: Recent[];
  /** Latest run per conversation id. */
  statuses?: Record<string, RecentStatus>;
  activeId?: string;
  disabled: boolean;
  onConversation(id: string): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();

  // Drop selections whose conversations went away.
  useEffect(() => {
    setSelected((ids) => {
      const next = ids.filter((id) => recent.some((c) => c.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [recent]);

  const click = (event: MouseEvent, id: string) => {
    if (event.shiftKey && anchor.current) {
      const ids = recent.map((c) => c.id);
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((a, b) => a - b);
      if (from >= 0) {
        setSelected(ids.slice(from, to + 1));
        return;
      }
    }
    anchor.current = id;
    if (event.metaKey || event.ctrlKey) {
      // Start from the open conversation, so Cmd-click adds to what's on screen.
      setSelected((ids) => {
        const base = ids.length || !activeId || activeId === id ? ids : [activeId];
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      return;
    }
    setSelected([]);
    onConversation(id);
  };

  const deleteSelected = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const store = useMistyStore.getState();
    const removed: string[] = [];
    try {
      for (const id of selected) {
        await store.deleteConversation(id);
        removed.push(id);
      }
      setConfirming(false);
      setSelected([]);
    } catch (failure) {
      setSelected((ids) => ids.filter((id) => !removed.includes(id)));
      setError(globalMistyError(failure));
    } finally {
      const open = params.get("conversation");
      if (open && removed.includes(open))
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete("conversation");
            return next;
          },
          { replace: true },
        );
      setBusy(false);
    }
  };

  const count = selected.length;
  return (
    <section
      className="agent-studio-recents"
      aria-label="Recent conversations"
      onKeyDown={(event) => {
        if (event.key === "Escape" && count) {
          event.stopPropagation();
          setSelected([]);
        }
      }}
    >
      {count ? (
        <div className="agent-studio-recents-selection" role="toolbar" aria-label="Selection">
          <span>{count} selected</span>
          <IconButton
            label={`Delete ${count} conversation${count === 1 ? "" : "s"}`}
            disabled={disabled}
            onClick={() => {
              setError("");
              setConfirming(true);
            }}
          >
            <Trash2 size={15} />
          </IconButton>
          <IconButton label="Clear selection" onClick={() => setSelected([])}>
            <X size={15} />
          </IconButton>
        </div>
      ) : (
        <h2>Recents</h2>
      )}
      {recent.map((c) => (
        <div
          key={c.id}
          className="agent-studio-recent-row"
          data-selected={selected.includes(c.id) || undefined}
        >
          <Button
            data-agent-navigation-control
            variant="ghost"
            justify="start"
            disabled={disabled}
            title={c.title || "Untitled conversation"}
            aria-current={activeId === c.id ? "page" : undefined}
            aria-pressed={count ? selected.includes(c.id) : undefined}
            onClick={(event) => click(event, c.id)}
          >
            <span>{c.title || "Untitled conversation"}</span>
            <RecentStatusIcon status={statuses?.[c.id]} />
          </Button>
          <AgentConversationActions conversation={c} disabled={disabled} />
        </div>
      ))}
      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            Delete {count} conversation{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They and their messages will be permanently deleted, along with any unsent drafts. This
            cannot be undone.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={disabled || busy} onClick={() => void deleteSelected()}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
});
