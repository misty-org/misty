import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAccountEvents } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { spacePersonalItemsApi, type SpacePersonalItem } from "@/api/spaces/personalItems";
import { readApiSessionGeneration } from "@/api/client/session";
const eventName = "misty:space-personal-items";
const pendingReads = new Map<string, Promise<{ items: SpacePersonalItem[] }>>();
function readItems(spaceId: string, scope: string) {
  let request = pendingReads.get(scope);
  if (!request) {
    request = spacePersonalItemsApi.list(spaceId);
    pendingReads.set(scope, request);
    void request.finally(() => pendingReads.delete(scope)).catch(() => {});
  }
  return request;
}
export function useSpacePersonalItems(spaceId: string) {
  const { user } = useAuth();
  const session = readApiSessionGeneration();
  const scope = `${session}:${user?.id ?? ""}:${spaceId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: SpacePersonalItem[] }>();
  const [failure, setFailure] = useState<{ scope: string; message: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user?.id || !spaceId) return;
    let active = true;
    let generation = 0;
    const read = () => {
      const current = ++generation;
      void readItems(spaceId, scope)
        .then((result) => {
          if (active && current === generation && session === readApiSessionGeneration()) {
            setSnapshot({ scope, items: result.items });
            setFailure(undefined);
          }
        })
        .catch(() => {
          if (active && current === generation && session === readApiSessionGeneration())
            setFailure({ scope, message: "Favorites and recent items couldn’t load." });
        });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId: string; item?: SpacePersonalItem }>).detail;
      if (detail?.spaceId !== spaceId) return;
      if (detail.item) {
        const item = detail.item;
        setSnapshot((current) =>
          current?.scope === scope
            ? { scope, items: [...current.items.filter((i) => i.item_key !== item.item_key), item] }
            : current,
        );
      }
      read();
    };
    const unsubscribe = subscribeAccountEvents(user.id, (event) => {
      if (event.topic === "reset" || event.topic === "space-personal-items") {
        pendingReads.delete(scope);
        read();
      }
    });
    read();
    window.addEventListener(eventName, changed);
    window.addEventListener("focus", read);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener(eventName, changed);
      window.removeEventListener("focus", read);
    };
  }, [scope, user?.id, spaceId, revision, session]);
  const update = useCallback(
    async (itemKey: string, patch: { favorite?: boolean; opened?: boolean }) => {
      try {
        const item = await spacePersonalItemsApi.update(spaceId, itemKey, patch);
        if (session !== readApiSessionGeneration() || currentScope.current !== scope) return;
        setFailure(undefined);
        pendingReads.delete(scope);
        window.dispatchEvent(new CustomEvent(eventName, { detail: { spaceId, item } }));
      } catch (cause) {
        if (session === readApiSessionGeneration() && currentScope.current === scope)
          setFailure({
            scope,
            message: cause instanceof Error ? cause.message : "Could not save this change.",
          });
        throw cause;
      }
    },
    [session, scope, spaceId],
  );
  return {
    items: snapshot?.scope === scope ? snapshot.items : [],
    error: failure?.scope === scope ? failure.message : "",
    ready: snapshot?.scope === scope,
    retry: () => setRevision((n) => n + 1),
    update,
  };
}
