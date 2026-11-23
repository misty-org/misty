import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_THREAD_EVENT,
  isSharedSpace,
  sharedThreadsApi,
  type SharedThread,
} from "./shared_threads";

export function useOthersThreads(spaceId: string, agentId: string, myUserId: string) {
  const shared = isSharedSpace(spaceId);
  const [others, setOthers] = useState<SharedThread[] | null>(shared ? null : []);
  const [failed, setFailed] = useState(false);
  const asking = useRef(0);

  const reload = useCallback(() => {
    const ask = ++asking.current;
    if (!shared || !spaceId || !agentId) {
      setOthers([]);
      return;
    }
    setFailed(false);
    void sharedThreadsApi.list(spaceId, agentId).then(
      (all) => {
        if (ask === asking.current)
          setOthers(all.filter((thread) => thread.owner_user_id !== myUserId));
      },
      () => {
        if (ask === asking.current) setFailed(true);
      },
    );
  }, [shared, spaceId, agentId, myUserId]);

  useEffect(() => {
    setOthers(shared ? null : []);
    setFailed(false);
  }, [shared, spaceId, agentId]);

  useEffect(() => {
    reload();
    if (!shared) return;
    const heard = (event: Event) => {
      const detail = (event as CustomEvent<{ payload?: { agent_id?: string } }>).detail;
      if (detail?.payload?.agent_id === agentId) reload();
    };
    window.addEventListener(AGENT_THREAD_EVENT, heard);
    return () => window.removeEventListener(AGENT_THREAD_EVENT, heard);
  }, [reload, shared, agentId]);

  return { shared, others, failed, reload };
}
