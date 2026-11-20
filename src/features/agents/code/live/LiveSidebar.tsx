import { useCallback, useEffect, useState } from "react";
import { useSpaceWindowStore } from "@/features/app-windows";
import { Button, EmptyState, ListRow, ListRowSkeleton, SectionHeading, Text } from "@misty/ui";
import { codeSessionsApi, type CodeSession } from "./codeSessionsApi";
import { GoLiveDialog } from "./GoLiveDialog";
import { liveApi, liveErrorText } from "./liveApi";
import { LiveJoined } from "./LiveJoined";
import { joinSession, restoreJoin } from "./liveSession";
import { useLiveStore } from "./liveStore";

/** How often the list of open sessions is read again while it shows. */
const listEveryMs = 30_000;

/** The Space's server id and the key its linked folders are kept under. */
function useSpaceIds() {
  const spaceId = useSpaceWindowStore((state) =>
    state.identity.personal ? state.personalSpaceId : state.identity.spaceId,
  );
  const spaceKey = useSpaceWindowStore((state) => state.identity.spaceId ?? "");
  return { spaceId, spaceKey };
}

/** The repository part of a repo key: "github.com/owner/repo". */
const repoName = (repoKey: string) => repoKey.slice(0, repoKey.lastIndexOf(":")) || repoKey;

/**
 * The Live activity's sidebar for the Space folder: this repository's live sessions with Go live
 * and Join, or, once joined, the people here and the history.
 */
export function LiveSidebar({ folder }: { folder: string }) {
  const join = useLiveStore((state) => state.joins[folder]);
  useEffect(() => useLiveStore.getState().hydrate(), []);
  useEffect(() => {
    if (join) restoreJoin(folder);
  }, [join, folder]);
  if (join) return <LiveJoined join={join} />;
  return <SessionList folder={folder} />;
}

function SessionList({ folder }: { folder: string }) {
  const { spaceId, spaceKey } = useSpaceIds();
  const repo = useLiveStore((state) => state.repos[folder]);
  const [sessions, setSessions] = useState<CodeSession[] | null>(null);
  const [listError, setListError] = useState("");
  const [goingLive, setGoingLive] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!folder) return;
    let live = true;
    liveApi
      .repo(folder, null, false)
      .then((found) => live && useLiveStore.getState().setRepo(folder, found))
      .catch(
        (reason) =>
          live && useLiveStore.getState().setRepo(folder, { error: liveErrorText(reason) }),
      );
    return () => {
      live = false;
    };
  }, [folder]);

  const load = useCallback(
    (live: () => boolean) => {
      if (!spaceId) return;
      codeSessionsApi
        .list(spaceId)
        .then(({ sessions: found }) => {
          if (!live()) return;
          setSessions(found);
          setListError("");
        })
        .catch((reason) => live() && setListError(liveErrorText(reason)));
    },
    [spaceId],
  );
  useEffect(() => {
    let live = true;
    setSessions(null);
    load(() => live);
    const timer = window.setInterval(() => load(() => live), listEveryMs);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const join = (session: CodeSession) => {
    if (!spaceId) return;
    setJoining(session.id);
    setJoinError(null);
    joinSession({ spaceId, spaceKey, spaceFolder: folder, session })
      .catch((reason) => setJoinError({ id: session.id, text: liveErrorText(reason) }))
      .finally(() => setJoining(null));
  };

  const repoError = repo && "error" in repo ? repo.error : "";
  const repoKey = repo && "repoKey" in repo ? repo.repoKey : null;
  const canGoLive = Boolean(repoKey && spaceId);
  const ours = (sessions ?? []).filter((session) => session.repoKey === repoKey);
  const others = (sessions ?? []).filter((session) => session.repoKey !== repoKey);
  const dialog = spaceId ? (
    <GoLiveDialog
      open={goingLive}
      onClose={() => setGoingLive(false)}
      folder={folder}
      spaceId={spaceId}
      spaceKey={spaceKey}
    />
  ) : null;

  if (!sessions || !repo) {
    if (listError)
      return (
        <EmptyState
          inline
          title="Live sessions couldn't load"
          line={listError}
          action={{ label: "Try again", variant: "secondary", onClick: () => load(() => true) }}
        />
      );
    return <ListRowSkeleton label="Live sessions" rows={3} lines={2} />;
  }
  if (repoError && !sessions.length)
    return <EmptyState inline title="Live sessions need a shared repository" line={repoError} />;
  if (!sessions.length)
    return (
      <>
        <EmptyState
          inline
          title="No live sessions"
          line="Edit this repository together, each in a worktree of your own."
          action={{ label: "Go live", onClick: () => setGoingLive(true) }}
        />
        {dialog}
      </>
    );
  return (
    <div className="grid min-w-0 content-start">
      <SectionHeading
        title="Live sessions"
        count={sessions.length}
        action={canGoLive ? { label: "Go live", onSelect: () => setGoingLive(true) } : undefined}
      />
      {ours.map((session) => (
        <div key={session.id} className="grid">
          <ListRow
            label={session.name}
            description={`Started by ${session.startedBy.name}`}
            trailing={
              <Button variant="secondary" disabled={joining !== null} onClick={() => join(session)}>
                Join
              </Button>
            }
          />
          {joinError?.id === session.id ? (
            <Text size="meta" tone="danger" wrap className="px-2 pb-2">
              {joinError.text}
            </Text>
          ) : null}
        </div>
      ))}
      {others.map((session) => (
        <ListRow
          key={session.id}
          label={session.name}
          description={`Needs a copy of ${repoName(session.repoKey)}`}
          disabled
        />
      ))}
      {repoError ? (
        <Text size="meta" tone="muted" wrap className="px-2 pt-2">
          {repoError}
        </Text>
      ) : null}
      {dialog}
    </div>
  );
}
