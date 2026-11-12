import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Input,
  Pressable,
} from "@/shared/ui";
import { folderName } from "../../../engines/enginesApi";
import {
  listEngineSessions,
  renameEngineSession,
  resumeEngineSession,
  searchEngineSessions,
  type EngineSession,
} from "./engineHistory";

const titleOf = (session: { title: string; customTitle?: string | null }) =>
  session.customTitle?.trim() || session.title.trim() || "Untitled session";

/**
 * Sessions from the engines' own history in this Space's linked folders: search them, rename
 * one (written back to the CLI's own files), or resume one in this chat.
 */
export function EngineHistoryDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  engine: string;
  conversationId?: string;
  onResumed?(): void;
}) {
  const [sessions, setSessions] = useState<EngineSession[]>();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Set<string>>();
  const [renaming, setRenaming] = useState<string>();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    void listEngineSessions()
      .then(setSessions)
      .catch((reason: unknown) => setError(String(reason)));
  }, [props.open]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setFound(undefined);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchEngineSessions(text)
        .then((page) => setFound(new Set(page.hits.map((hit) => `${hit.engine}:${hit.sessionId}`))))
        .catch(() => setFound(new Set()));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const shown = useMemo(
    () =>
      (sessions ?? [])
        .filter((session) => session.engine === props.engine)
        .filter((session) => !found || found.has(`${session.engine}:${session.sessionId}`))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [sessions, found, props.engine],
  );

  const resume = async (session: EngineSession) => {
    if (!props.conversationId) return;
    try {
      await resumeEngineSession(props.conversationId, session);
      props.onResumed?.();
      props.onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const rename = async (session: EngineSession) => {
    const next = title.trim();
    setRenaming(undefined);
    if (!next || next === titleOf(session)) return;
    try {
      await renameEngineSession(session.engine, session.sessionId, next);
      setSessions((current) =>
        current?.map((item) =>
          item.sessionId === session.sessionId && item.engine === session.engine
            ? { ...item, customTitle: next }
            : item,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="engine-history">
        <DialogTitle>Resume a session</DialogTitle>
        <Input
          aria-label="Search sessions"
          placeholder="Search messages"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {sessions === undefined && !error ? (
          <ul className="engine-history-list" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <li key={row} className="engine-history-skeleton" />
            ))}
          </ul>
        ) : (
          <ul className="engine-history-list">
            {shown.map((session) => (
              <li key={`${session.engine}:${session.sessionId}`} className="engine-history-row">
                {renaming === session.sessionId ? (
                  <Input
                    autoFocus
                    aria-label="Session name"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => void rename(session)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void rename(session);
                      if (event.key === "Escape") setRenaming(undefined);
                    }}
                  />
                ) : (
                  <Pressable className="engine-history-pick" onClick={() => void resume(session)}>
                    <span className="engine-history-title">{titleOf(session)}</span>
                    <span className="engine-history-meta">
                      {folderName(session.workspacePath)} · {session.messageCount} messages
                    </span>
                  </Pressable>
                )}
                <IconButton
                  label="Rename session"
                  onClick={() => {
                    setTitle(titleOf(session));
                    setRenaming(session.sessionId);
                  }}
                >
                  <Pencil className="size-3.5" />
                </IconButton>
              </li>
            ))}
            {!shown.length ? <li className="engine-history-empty">No sessions</li> : null}
          </ul>
        )}
        {error ? (
          <p className="engine-question-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="engine-plan-actions">
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
