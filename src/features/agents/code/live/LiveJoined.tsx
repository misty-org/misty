import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  formatRowTime,
  ListRow,
  MenuItem,
  SectionHeading,
  SetupState,
  Text,
} from "@/shared/ui";
import { PersonAvatar } from "../../tutor/notebook/LivePeople";
import { personTone } from "../../tutor/personTone";
import { liveErrorText } from "./liveApi";
import { LiveLanes } from "./LiveLanes";
import { useRoomView } from "./livePeople";
import { leaveSession, retryJoin, runningSession } from "./liveSession";
import { useLiveStore } from "./liveStore";
import { mainAuthor, type LiveJoin, type LiveStep } from "./liveTypes";

/** Who wrote a step, as its row says it: an agent with its person. */
function byLine(step: LiveStep): string {
  if (step.author.id === mainAuthor.id) return "main";
  return step.author.kind === "agent"
    ? `${step.author.name} for ${step.author.ownerName}`
    : step.author.name;
}

/** The sidebar once this window joined a session: the people here, then the history. */
export function LiveJoined({ join }: { join: LiveJoin }) {
  const state = useLiveStore((store) => store.rooms[join.sessionId]);
  const roomError = useLiveStore((store) => store.roomErrors[join.sessionId]);
  const mainAhead = useLiveStore((store) => store.mainAhead[join.sessionId] ?? null);
  const selected = useLiveStore((store) => store.selectedStep);
  const room = state === "ready" ? runningSession(join.sessionId)?.room : undefined;
  const { steps, people, present } = useRoomView(room);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  const leave = () => {
    setLeaving(true);
    setError("");
    leaveSession(join)
      .catch((reason) => setError(liveErrorText(reason)))
      .finally(() => setLeaving(false));
  };
  const failure = error ? (
    <Text size="meta" tone="danger" wrap className="px-2 pt-2">
      {error}
    </Text>
  ) : null;

  const starter = room ? join.startedById === room.me.id : false;
  const heading = (
    <SectionHeading
      title={join.name}
      action={{
        label: "Session actions",
        icon: MoreHorizontal,
        menu: (
          <>
            {starter ? (
              <MenuItem
                label="End session"
                onSelect={() => useLiveStore.getState().setEnding(true)}
              />
            ) : null}
            <MenuItem label="Leave session" disabled={leaving} onSelect={leave} />
          </>
        ),
      }}
    />
  );

  if (state === "ended" || state === "revoked")
    return (
      <div className="grid min-w-0 content-start">
        {heading}
        {failure}
        <EmptyState
          inline
          title={
            state === "ended" ? "This session ended" : "You no longer have access to this session"
          }
          action={{ label: "Leave", variant: "secondary", disabled: leaving, onClick: leave }}
        />
      </div>
    );
  if (!room)
    return (
      <div className="grid min-w-0 content-start">
        {heading}
        {failure}
        {/* The room joining and syncing: a step that can fail, said in words, never a skeleton. */}
        <SetupState
          tool="live session"
          label="Joining the live session"
          size="inline"
          error={state === "failed" ? roomError || "The session couldn't open." : null}
          onRetry={state === "failed" ? () => retryJoin(join) : undefined}
        />
      </div>
    );

  const newest = [...steps].sort((a, b) => b.at - a.at);
  const now = Date.now();
  return (
    <div className="grid min-w-0 content-start">
      {heading}
      {failure}
      {present.map((person) => (
        <ListRow
          key={person.id}
          label={person.id === room.me.id ? `${person.name} (you)` : person.name}
          description={person.path ?? undefined}
          leading={
            <PersonAvatar
              spaceId={join.spaceId}
              size="xs"
              person={{ id: person.id, name: person.name, tone: personTone(person.id) }}
            />
          }
        />
      ))}
      <SectionHeading title="History" className="mt-2" />
      <LiveLanes
        steps={steps}
        people={people}
        mainAhead={mainAhead}
        selected={selected}
        onSelect={(id) => useLiveStore.getState().selectStep(id)}
      />
      {mainAhead ? (
        <Text size="meta" tone="muted" className="px-2 pb-2">
          {`main is ${mainAhead} ${mainAhead === 1 ? "commit" : "commits"} ahead`}
        </Text>
      ) : null}
      {newest.map((step) => (
        <ListRow
          key={step.id}
          label={step.summary}
          description={byLine(step)}
          selected={step.id === selected}
          state={{ kind: "time", at: step.at }}
          onOpen={() => useLiveStore.getState().selectStep(step.id === selected ? null : step.id)}
          aria-label={`${step.summary}, ${byLine(step)}, ${formatRowTime(step.at, now)}`}
        />
      ))}
    </div>
  );
}
