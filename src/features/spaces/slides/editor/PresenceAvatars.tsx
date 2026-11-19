import { Avatar, AvatarFallback, Tooltip, type AvatarTone } from "@/shared/ui";
import type { DeckPeer } from "../hooks/useDeckPresence";

const tones: AvatarTone[] = ["blue", "red", "green", "orange", "violet", "pink", "amber", "teal"];

/** A person's avatar tone, the same for them everywhere in the deck. */
export function peerTone(id: string): AvatarTone {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toLocaleUpperCase();
}

/** Who else has the deck open, as overlapping avatars; the rest count as +N. */
export function PresenceAvatars(props: { peers: DeckPeer[]; max?: number; size?: "xs" | "sm" }) {
  const max = props.max ?? 4;
  if (!props.peers.length) return null;
  const shown = props.peers.slice(0, max);
  const rest = props.peers.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5" aria-label="Also here">
      {shown.map((peer) => (
        <Tooltip key={peer.user.id} content={peer.user.name}>
          <Avatar
            size={props.size ?? "sm"}
            tone={peerTone(peer.user.id)}
            aria-label={peer.user.name}
          >
            <AvatarFallback>{initial(peer.user.name)}</AvatarFallback>
          </Avatar>
        </Tooltip>
      ))}
      {rest > 0 ? (
        <Avatar size={props.size ?? "sm"} aria-label={`${rest} more`}>
          <AvatarFallback>+{rest}</AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  );
}
