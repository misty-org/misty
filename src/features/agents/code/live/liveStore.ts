import { useEffect, useState } from "react";
import { create } from "zustand";
import { agentAccountId } from "../../personal/agentAccount";
import type { LiveRoom } from "./liveRoom";
import type { LiveJoin, LiveRepo } from "./liveTypes";

/** How this window's room for a session stands. */
export type RoomState = "connecting" | "ready" | "ended" | "revoked" | "failed";

interface LiveState {
  /** The session joined from each Space folder, by that folder. */
  joins: Record<string, LiveJoin>;
  /** The account whose saved joins were read back. */
  hydrated: string | null;
  rooms: Record<string, RoomState>;
  /** Why joining or opening a session's room failed, by session. */
  roomErrors: Record<string, string>;
  /** Each Space folder's repository, as last read. */
  repos: Record<string, LiveRepo | { error: string }>;
  /** How many commits the remote's default branch has past each session's base. */
  mainAhead: Record<string, number | null>;
  /** The step shown in the main area. */
  selectedStep: string | null;
  /** The author key whose highlights alone show in the editor; null shows everyone's. */
  only: string | null;
  /** The end-session flow is open in the main area. */
  ending: boolean;
  /** Reads back the joins this device saved for the signed-in account, once. */
  hydrate(): void;
  setJoin(join: LiveJoin): void;
  clearJoin(spaceFolder: string): void;
  setRoom(sessionId: string, state: RoomState, error?: string): void;
  setRepo(folder: string, repo: LiveRepo | { error: string }): void;
  setMainAhead(sessionId: string, ahead: number | null): void;
  selectStep(id: string | null): void;
  showOnly(key: string | null): void;
  setEnding(open: boolean): void;
}

const savedKey = () => `misty:code-live-joins:${agentAccountId()}`;

/** The sessions joined on this device, so a reload joins them again. Folder paths carry no secret. */
function savedJoins(): Record<string, LiveJoin> {
  try {
    const text = window.localStorage.getItem(savedKey());
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LiveJoin>) : {};
  } catch {
    return {};
  }
}

function saveJoins(joins: Record<string, LiveJoin>) {
  try {
    window.localStorage.setItem(savedKey(), JSON.stringify(joins));
  } catch {
    /* a device that can't keep it joins again by hand */
  }
}

export const useLiveStore = create<LiveState>((set, get) => ({
  joins: {},
  hydrated: null,
  rooms: {},
  roomErrors: {},
  repos: {},
  mainAhead: {},
  selectedStep: null,
  only: null,
  ending: false,
  hydrate() {
    const account = agentAccountId();
    if (!account || get().hydrated === account) return;
    set({ joins: { ...savedJoins(), ...get().joins }, hydrated: account });
  },
  setJoin(join) {
    const joins = { ...get().joins, [join.spaceFolder]: join };
    set({ joins });
    saveJoins(joins);
  },
  clearJoin(spaceFolder) {
    const joins = { ...get().joins };
    delete joins[spaceFolder];
    set({ joins, selectedStep: null, only: null, ending: false });
    saveJoins(joins);
  },
  setRoom(sessionId, state, error) {
    const roomErrors = { ...get().roomErrors };
    if (error) roomErrors[sessionId] = error;
    else delete roomErrors[sessionId];
    set({ rooms: { ...get().rooms, [sessionId]: state }, roomErrors });
  },
  setRepo(folder, repo) {
    set({ repos: { ...get().repos, [folder]: repo } });
  },
  setMainAhead(sessionId, ahead) {
    set({ mainAhead: { ...get().mainAhead, [sessionId]: ahead } });
  },
  selectStep(id) {
    set({ selectedStep: id, ending: id ? false : get().ending });
  },
  showOnly(key) {
    set({ only: key });
  },
  setEnding(open) {
    set({ ending: open, selectedStep: open ? null : get().selectedStep });
  },
}));

/** The join whose worktree holds `path`, if any. */
export function joinHolding(joins: Record<string, LiveJoin>, path: string): LiveJoin | null {
  for (const join of Object.values(joins)) {
    const root = join.folder.replace(/\/+$/, "");
    if (path === root || path.startsWith(`${root}/`)) return join;
  }
  return null;
}

/** The session this window works in now: the one joined most recently. */
export function activeJoin(joins: Record<string, LiveJoin>): LiveJoin | null {
  const all = Object.values(joins);
  return all.length ? all[all.length - 1]! : null;
}

/**
 * A number that changes whenever the room's doc or awareness does, at most once a frame, so a
 * view reading the doc paints again.
 */
export function useRoomVersion(room: LiveRoom | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!room) return;
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setVersion((value) => value + 1);
      });
    };
    room.doc.on("update", bump);
    room.provider.awareness.on("change", bump);
    bump();
    return () => {
      window.cancelAnimationFrame(frame);
      room.doc.off("update", bump);
      room.provider.awareness.off("change", bump);
    };
  }, [room]);
  return version;
}
