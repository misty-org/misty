import { createMisty, type AppContext, type Misty } from "@misty/sdk";
import * as Y from "yjs";
import { useUserStore } from "@/features/account/core";
import { spaceRequest } from "../api/api";
import { createYjsProvider } from "../journal/notes/createYjsProvider";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "../journal/notes/noteCollaboration";
import { useSpacesStore } from "../list/useSpacesStore";
import { providerRoom, type HostRoom, type RoomSource } from "./appRooms";
import { createHostChannel, type FrameTarget } from "./hostChannel";
import { createSpaceAppHandlers } from "./spaceAppHandlers";
import { themeSource } from "./themeSource";

/** Misty's own pages that work together through misty-sdk, as any app does. */
export type MistyPage = "code" | "lab";

interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
}

/** Code's rooms: a room id is a live session's id, and its room is the session's shared repository. */
function codeRoomSource(spaceId: string): RoomSource {
  const ticket = (sessionId: string) =>
    spaceRequest<RoomTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/code-sessions/${encodeURIComponent(sessionId)}/collaboration-ticket`,
      { method: "POST" },
    );
  return async (sessionId, { gc }) => {
    const first = await ticket(sessionId);
    const doc = new Y.Doc({ gc });
    return providerRoom(createYjsProvider(first, doc, "code-room", () => ticket(sessionId)), doc);
  };
}

/**
 * Lab's rooms: a room id is a notebook's doc id, and its room is that Space doc's, the same one the doc's own
 * page edits. The connection is shared with that page, so the host's own presence in it is left as it is.
 */
function labRoomSource(spaceId: string): RoomSource {
  return async (docId): Promise<HostRoom> => {
    const session = await acquireNoteCollaborationSession(spaceId, docId);
    const provider = session.provider;
    let released = false;
    const synced = provider.synced
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const onSync = (done: boolean) => {
            if (!done) return;
            provider.off("sync", onSync);
            resolve();
          };
          provider.on("sync", onSync);
        });
    return {
      doc: session.doc,
      awareness: provider.awareness,
      synced,
      lost: () => session.access.lost,
      onLost: (listener) => session.access.subscribe(listener),
      close() {
        if (released) return;
        released = true;
        releaseNoteCollaborationSession(spaceId, docId);
      },
    };
  };
}

const pageNames: Record<MistyPage, string> = { code: "Code", lab: "Lab" };

const clients = new Map<string, Misty>();

/**
 * The SDK client a Misty page talks through in a Space: the same channel, handlers and calls an installed app
 * gets, in this window instead of a sandboxed frame. Native code's check stands aside, since the page is Misty's
 * own; the server still decides every room and file. One client per page and Space, kept while Misty runs.
 */
export function pageMisty(spaceId: string, page: MistyPage): Misty {
  const key = `${page}:${spaceId}`;
  const known = clients.get(key);
  if (known) return known;

  const space = useSpacesStore.getState().spaces.find((candidate) => candidate.id === spaceId);
  const me = useUserStore.getState().me;
  const isMod = Boolean(space?.permissions?.includes("apps.manage"));
  const route: AppContext["route"] = { path: "/", params: {} };
  const context: AppContext = {
    app_id: page,
    space: { id: spaceId, name: space?.name ?? "", is_mod: isMod },
    me: {
      user_id: me?.id ?? "",
      name: me?.username || me?.email || "",
      role: space?.role ?? "member",
      avatar_version: me?.avatar_version,
    },
    theme: themeSource.get(),
    route,
    permissions: [],
  };
  const handlers = createSpaceAppHandlers({
    appId: page,
    appName: pageNames[page],
    space: { id: spaceId, name: context.space.name, isMod },
    me: context.me,
    permissions: [],
    theme: themeSource,
    route: { get: () => route, subscribe: () => () => {} },
    navigate: () => {},
    files: { pickFiles: async () => [], saved: () => {} },
    rooms: page === "code" ? codeRoomSource(spaceId) : labRoomSource(spaceId),
  });

  // The page's end of the channel, handed over as a frame's would be.
  const handed: { port?: MessagePort } = {};
  const frame: FrameTarget = {
    postMessage: (_message, _origin, transfer) => {
      handed.port = transfer[0] as MessagePort;
    },
  };
  const host = createHostChannel({ frame, authorize: async () => {}, handlers });
  host.start();
  if (!handed.port) throw new Error("The page's channel didn't open.");
  const misty = createMisty(handed.port, context, { applyTheme: false });
  // Closing the client (on sign-out) lets go of the host's end and everything it held.
  misty.onClose(() => host.dispose());
  clients.set(key, misty);
  return misty;
}

// Another account's pages start over: their rooms and files are that account's.
useUserStore.subscribe((state, previous) => {
  if (state.me?.id === previous.me?.id) return;
  for (const misty of clients.values()) misty.close();
  clients.clear();
});
