import { useCallback, useEffect, useRef, useState } from "react";
import type { OperationQueueSnapshot, TransferPage } from "@/native/ipc";
import { operationQueueSnapshot, transfersSnapshot } from "@/native/transfers-tools";
import { errorText } from "@/shared/lib/format";
import { useOperationQueueStore } from "../workspace/explorer/store/useOperationQueueStore";
import type { TransferSection } from "./transferModel";

export const transfersPageSize = 50;
export function useTransfers(section: TransferSection, search: string, offset: number) {
  const [data, setData] = useState<{
    key: string;
    page: TransferPage;
    queue: OperationQueueSnapshot;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const key = JSON.stringify([section, search, offset]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const [page, queue] = await Promise.all([
          transfersSnapshot({ section, search, offset, limit: transfersPageSize }),
          operationQueueSnapshot(),
        ]);
        if (!disposed) {
          setData({ key, page, queue });
          setError(null);
          useOperationQueueStore.setState({ snapshot: queue });
        }
      } catch (cause) {
        if (!disposed) setError(errorText(cause));
      } finally {
        inFlight = false;
      }
    };
    setError(null);
    const initial = window.setTimeout(() => void poll(), search ? 200 : 0);
    const timer = window.setInterval(() => void poll(), 1000);
    const visible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key, section, search, offset, revision]);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<OperationQueueSnapshot>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setWorking(true);
    setActionError(null);
    try {
      const snapshot = await action();
      useOperationQueueStore.setState({ snapshot });
      if (mounted.current) {
        setData((current) => (current ? { ...current, queue: snapshot } : current));
        setRevision((value) => value + 1);
      }
    } catch (cause) {
      if (mounted.current) setActionError(errorText(cause));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setWorking(false);
    }
  }, []);
  const current = data?.key === key ? data : null;
  return {
    page: current?.page,
    queue: current?.queue,
    loading: !current && !error,
    error,
    actionError,
    working,
    run,
    refresh: () => setRevision((value) => value + 1),
  };
}
