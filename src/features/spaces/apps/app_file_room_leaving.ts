import type * as Y from "yjs";
import type { PausedEdits } from "./app_file_room_copies";
import type { SyncHold } from "./app_file_room_hold";
import type { FileRoomMessage } from "./app_file_room_messages";

export interface FrozenRoom {
  doc: Y.Doc;
  hold: SyncHold;
  paused: PausedEdits;
  generation(): string | undefined;
  linked(): boolean;
  pause(): { accepted: boolean; sentOn: number } | null;
  links(): number;
  settle(): void;
  finish(): void;
}

export interface FrozenLeave {
  readonly holding: boolean;
  hold(): boolean;
  heard(said: FileRoomMessage): void;
  over(): void;
}

const RELOADED_LOSS =
  "An app left its file while the file's live room was paused, and the room was then opened afresh, so the app's edits from the pause weren't kept.";
const TOO_MANY_LOSS = "An app left its file while the file's live room was paused, with more edits than Misty could hold, so they weren't kept.";
const UNLINKED_LOSS =
  "An app left its file while the file's live room was paused, and the link was down when the pause ended, so the app's edits weren't kept.";

export function frozenLeave(room: FrozenRoom): FrozenLeave {
  let holding = false;
  const tooMany = () => console.warn(TOO_MANY_LOSS);
  const thaw = () => {
    if (!holding) return;
    holding = false;
    const accepted = room.pause()?.accepted === true;
    if (room.paused.lost) tooMany();
    else if (room.linked() && !room.hold.active) {
      room.paused.replay(room.doc);
      if (accepted) room.hold.resendAll();
    } else {
      room.paused.clear();
      console.warn(UNLINKED_LOSS);
    }
    room.settle();
  };
  return {
    get holding() {
      return holding;
    },
    hold() {
      holding = room.pause() !== null && room.paused.count > 0;
      if (holding && room.paused.lost) {
        holding = false;
        tooMany();
      }
      return holding;
    },
    heard(said) {
      if (!holding) return;
      if (said.type === "file_writer") {
        const at = room.generation();
        if (said.generation !== undefined && at !== undefined && said.generation !== at) {
          holding = false;
          console.warn(RELOADED_LOSS);
          room.paused.clear();
          room.finish();
          return;
        }
        if (room.hold.active) room.hold.release(true);
        const pause = room.pause();
        if (said.resolving !== undefined && pause) pause.accepted = true;
        else if (said.resolving === undefined && pause && (pause.accepted || pause.sentOn !== room.links())) thaw();
        return;
      }
      if (said.type === "file_outside" || (said.type === "file_resolve_declined" && room.pause()?.accepted === false)) thaw();
    },
    over: () => {
      thaw();
      room.finish();
    },
  };
}
