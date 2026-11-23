import { createMisty, FIRST_OFFERS, type HelloResult, type Misty } from "@misty/sdk";
import * as Y from "yjs";
import { useUserStore } from "@/features/account/core";
import {
  createYjsProvider,
  firstCollaborationTicket,
  requestCollaborationTicket,
} from "../journal/notes/create_yjs_provider";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "../journal/notes/note_collaboration";
import { useSpacesStore } from "../list/use_spaces_store";
import { providerRoom, ROOM_FEATURES, type HostRoom, type RoomSource } from "./app_rooms";
import { createHostChannel, type FrameTarget } from "./host_channel";
import { createSpaceAppHandlers, HOST_TOPICS } from "./space_app_handlers";
import { themeSource } from "./theme_source";

export type MistyPage = "code" | "lab";

interface RoomTicket {
  ticket: string;
  room: string;
  url: string;
}

function codeRoomSource(spaceId: string): RoomSource {
  const ticket = (sessionId: string) =>
    requestCollaborationTicket<RoomTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/code-sessions/${encodeURIComponent(sessionId)}/collaboration-ticket`,
    );
  return async (sessionId, { gc, signal }) => {
    const first = await firstCollaborationTicket(() => ticket(sessionId), signal);
    const doc = new Y.Doc({ gc });
    return providerRoom(
      createYjsProvider(first, doc, "code-room", () => ticket(sessionId)),
      doc,
    );
  };
}

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

const pageOffers = {
  calls: [...new Set([...FIRST_OFFERS.calls, "room.sync", "room.serialized"])],
  topics: [...new Set([...FIRST_OFFERS.topics, ...HOST_TOPICS, ...ROOM_FEATURES])],
};

const clients = new Map<string, Misty>();

export function pageMisty(spaceId: string, page: MistyPage): Misty {
  const key = `${page}:${spaceId}`;
  const known = clients.get(key);
  if (known) return known;

  const space = useSpacesStore.getState().spaces.find((candidate) => candidate.id === spaceId);
  const me = useUserStore.getState().me;
  const isMod = Boolean(space?.permissions?.includes("apps.manage"));
  const route: HelloResult["route"] = { path: "/", params: {} };
  const context: HelloResult = {
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
    offers: pageOffers,
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
  misty.onClose(() => host.dispose());
  clients.set(key, misty);
  return misty;
}

useUserStore.subscribe((state, previous) => {
  if (state.me?.id === previous.me?.id) return;
  for (const misty of clients.values()) misty.close();
  clients.clear();
});
