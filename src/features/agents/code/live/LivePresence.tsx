import { Text, Tooltip } from "@misty/ui";
import { PersonAvatar } from "../../tutor/notebook/LivePeople";
import { personTone } from "../../tutor/personTone";
import { useRoomView } from "./livePeople";
import { runningSession } from "./liveSession";
import { activeJoin, useLiveStore } from "./liveStore";

/** The faces of everyone else in the joined session, for the Code page's top bar. */
export function LivePresence() {
  const join = useLiveStore((state) => activeJoin(state.joins));
  const open = useLiveStore((state) => (join ? state.rooms[join.sessionId] === "ready" : false));
  const room = join && open ? runningSession(join.sessionId)?.room : undefined;
  const { present } = useRoomView(room);
  const others = room ? present.filter((person) => person.id !== room.me.id) : [];
  if (!join || !others.length) return null;
  const shown = others.slice(0, 4);
  return (
    <div className="flex items-center -space-x-1.5" aria-label="People in this session">
      {shown.map((person) => (
        <Tooltip
          key={person.id}
          content={person.path ? `${person.name} in ${person.path}` : person.name}
        >
          <span className="inline-flex">
            <PersonAvatar
              spaceId={join.spaceId}
              person={{ id: person.id, name: person.name, tone: personTone(person.id) }}
            />
          </span>
        </Tooltip>
      ))}
      {others.length > shown.length ? (
        <Text bare size="caption" tone="muted" className="pl-2.5">
          +{others.length - shown.length}
        </Text>
      ) : null}
    </div>
  );
}
