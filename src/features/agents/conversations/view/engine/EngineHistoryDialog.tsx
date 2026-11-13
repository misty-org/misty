import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCachedResource } from "@/api/cache/cached-resource";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  RenameItemDialog,
  Skeleton,
  Text,
} from "@/shared/ui";
import { folderName } from "../../../engines/enginesApi";
import { resumeInNewChat } from "../../startChat";
import {
  listEngineSessions,
  renameEngineSession,
  resumeEngineSession,
  searchEngineSessions,
  sessionsByFolder,
  type EngineSession,
} from "./engineHistory";
import { agentForPastChat, pastChatRoute } from "./pastChats";

/** Before the first read: two folders' heads (name and path), each over its chats. */
const historySkeleton = (
  <div role="status" aria-label="Past chats" aria-busy="true" className="grid gap-4">
    {["w-24", "w-20"].map((width) => (
      <div key={width} className="grid">
        <div className="flex h-6 items-center gap-2 px-2 pb-1">
          <Skeleton className={`h-3 shrink-0 rounded-sm ${width}`} />
          <Skeleton className="h-2.5 w-48 min-w-0 rounded-sm" />
        </div>
        <ListRowSkeleton label="Past chats" rows={5} state />
      </div>
    ))}
  </div>
);

const titleOf = (session: { title: string; customTitle?: string | null }) =>
  session.customTitle?.trim() || session.title.trim() || "Untitled session";

/**
 * Past chats from this engine's own history, from every folder they ran in, grouped by folder:
 * search them, rename one (written back to the CLI's own files), or continue one. A chat from
 * this agent's folder continues here; one from a folder another agent on this engine works in
 * continues in a new chat with that agent; from any other folder the person is asked first which
 * agent gets the folder.
 */
export function EngineHistoryDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  engine: string;
  agentId?: string;
  conversationId?: string;
  onResumed?(): void;
}) {
  const navigate = useNavigate();
  // The engines' own history, read each time the dialog opens; the last read shows meanwhile. It
  // holds what was said in each chat, so it stays in this session's memory, never on disk.
  const history = useCachedResource<EngineSession[]>(
    props.open ? "agents/engine-history" : null,
    listEngineSessions,
  );
  const sessions = history.data;
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Set<string>>();
  const [renaming, setRenaming] = useState<EngineSession>();
  const [resumeError, setResumeError] = useState("");
  const error = resumeError || (history.error && !sessions ? String(history.error) : "");
  // A chat that couldn't continue reopens the dialog to say so; closing it again clears that.
  useEffect(() => {
    if (!props.open) setResumeError("");
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

  const groups = useMemo(
    () =>
      sessionsByFolder(
        (sessions ?? [])
          .filter((session) => session.engine === props.engine)
          .filter((session) => !found || found.has(`${session.engine}:${session.sessionId}`)),
      ),
    [sessions, found, props.engine],
  );

  const resume = async (session: EngineSession) => {
    const chat = { ...session, title: titleOf(session) };
    // The folder question is its own dialog, so this one closes first.
    props.onOpenChange(false);
    try {
      const chosen = await agentForPastChat(chat, props.agentId);
      if (!chosen) return;
      const there = { ...chat, workspacePath: chosen.folder };
      if (chosen.agentId === props.agentId && props.conversationId) {
        await resumeEngineSession(props.conversationId, there);
        props.onResumed?.();
        return;
      }
      const conversation = await resumeInNewChat(chosen.agentId, there);
      void navigate(pastChatRoute(chosen.agentId, conversation));
    } catch (reason) {
      setResumeError(reason instanceof Error ? reason.message : String(reason));
      props.onOpenChange(true);
    }
  };

  const rename = async (session: EngineSession, title: string) => {
    if (title === titleOf(session)) return;
    await renameEngineSession(session.engine, session.sessionId, title);
    history.set((current) =>
      (current ?? []).map((item) =>
        item.sessionId === session.sessionId && item.engine === session.engine
          ? { ...item, customTitle: title }
          : item,
      ),
    );
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent size="md" layout="scroll" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Past chats</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Search past chats"
            placeholder="Search messages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <DialogBody>
            {history.loading ? (
              historySkeleton
            ) : (
              <div className="grid gap-4">
                {groups.map((group) => (
                  <section key={group.path} aria-label={folderName(group.path)} className="grid">
                    <div className="flex min-w-0 items-baseline gap-2 px-2 pb-1">
                      <Text size="control" weight="medium" className="shrink-0">
                        {folderName(group.path)}
                      </Text>
                      <Text size="meta" tone="muted" full className="min-w-0 flex-1">
                        {group.path}
                      </Text>
                    </div>
                    {group.sessions.map((session) => (
                      <ListRow
                        key={`${session.engine}:${session.sessionId}`}
                        label={titleOf(session)}
                        state={
                          session.updatedAt
                            ? { kind: "time", at: session.updatedAt }
                            : { kind: "none" }
                        }
                        onOpen={() => void resume(session)}
                        menuLabel="Past chat actions"
                        menu={
                          <MenuItem
                            icon={Pencil}
                            label="Rename"
                            onSelect={() => setRenaming(session)}
                          />
                        }
                      />
                    ))}
                  </section>
                ))}
                {!groups.length && !error ? (
                  <Text size="body" tone="muted" className="px-2">
                    {query.trim() ? "No past chats match" : "No past chats yet"}
                  </Text>
                ) : null}
              </div>
            )}
          </DialogBody>
          {error ? (
            <Text size="meta" tone="danger" wrap role="alert">
              {error}
            </Text>
          ) : null}
        </DialogContent>
      </Dialog>
      {renaming ? (
        <RenameItemDialog
          key={`${renaming.engine}:${renaming.sessionId}`}
          title="Rename chat"
          initialName={titleOf(renaming)}
          onConfirm={(name) => rename(renaming, name)}
          onClose={() => setRenaming(undefined)}
        />
      ) : null}
    </>
  );
}
