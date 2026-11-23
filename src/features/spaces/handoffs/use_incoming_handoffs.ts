import { useEffect, useMemo } from "react";
import { useUserStore } from "@/features/account/core";
import { spacesApi } from "../api/api";
import type { SpaceMessage } from "../api/dto/entities";
import { useSpaceResource } from "../api/space_resource";
import { useSpacesStore } from "../list/use_spaces_store";
import { useHandledHandoffs } from "./handled_handoffs";
import { incomingHandoffs, pendingHandoffs, type IncomingHandoff } from "./space_posts";

const noMessages: SpaceMessage[] = [];
const readDms = new Set<string>();

async function directMessages(spaceId: string, me: string): Promise<SpaceMessage[]> {
  const [{ dms }, { members }] = await Promise.all([
    spacesApi.directMessages(),
    spacesApi.members(spaceId),
  ]);
  const inSpace = new Set(members.map((member) => member.user_id));
  const loaded = await Promise.allSettled(
    dms
      .filter(
        (dm) =>
          dm.kind === "direct" &&
          dm.members.some((member) => member.user_id !== me && inSpace.has(member.user_id)),
      )
      .map((dm) => {
        readDms.add(dm.id);
        return spacesApi.messages(dm.id);
      }),
  );
  return loaded.flatMap((result) => (result.status === "fulfilled" ? result.value.messages : []));
}

export function useIncomingHandoffs(spaceId: string): {
  handoffs: IncomingHandoff[] | undefined;
  me: string;
} {
  const me = useUserStore((state) => state.me?.id ?? "");
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const mainChat = useSpacesStore((state) => state.messagesBySpace[spaceId]);
  const handled = useHandledHandoffs(me, spaceId);
  const direct = useSpaceResource(
    me && !referenceOnly ? `/spaces/${encodeURIComponent(spaceId)}/handoffs/direct-messages` : null,
    () => directMessages(spaceId, me),
  );
  const reloadDirect = direct.reload;

  useEffect(() => {
    if (!me || referenceOnly) return;
    let timer = 0;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; space_id?: string }>).detail;
      const from = detail?.spaceId ?? detail?.space_id ?? "";
      if (from !== spaceId && !readDms.has(from)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reloadDirect(), 500);
    };
    window.addEventListener("misty:space-message-event", changed);
    window.addEventListener("misty:space-conversation-event", changed);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("misty:space-message-event", changed);
      window.removeEventListener("misty:space-conversation-event", changed);
    };
  }, [me, referenceOnly, reloadDirect, spaceId]);

  const directNow = direct.data ?? (direct.error ? noMessages : undefined);
  const handoffs = useMemo(() => {
    if (!me || referenceOnly) return [];
    if (!directNow) return undefined;
    return pendingHandoffs(
      [
        ...incomingHandoffs(directNow, me, true),
        ...incomingHandoffs(mainChat ?? noMessages, me, false),
      ],
      handled,
    );
  }, [directNow, handled, mainChat, me, referenceOnly]);
  return { handoffs, me };
}
