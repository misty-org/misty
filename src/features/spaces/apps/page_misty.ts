import { createMisty, FIRST_OFFERS, type HelloResult, type Misty } from "@misty/sdk";
import { useUserStore } from "@/features/account/core";
import { useSpacesStore } from "../list/use_spaces_store";
import { createHostChannel, type FrameTarget } from "./host_channel";
import { createSpaceAppHandlers, HOST_TOPICS } from "./space_app_handlers";
import { ROOM_CALLS, ROOM_TOPICS } from "./space_rooms";
import { themeSource } from "./theme_source";

export type MistyPage = "code" | "lab";

const pageNames: Record<MistyPage, string> = { code: "Code", lab: "Lab" };

const pageOffers = {
  calls: [...new Set([...FIRST_OFFERS.calls, ...ROOM_CALLS])],
  topics: [...new Set([...FIRST_OFFERS.topics, ...HOST_TOPICS, ...ROOM_TOPICS])],
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
