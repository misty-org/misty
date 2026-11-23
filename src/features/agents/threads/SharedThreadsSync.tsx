import { useEffect } from "react";
import { startSharedThreadsSync } from "./shared_threads";
import { watchThreadWork } from "./thread_work";

export function SharedThreadsSync() {
  useEffect(() => {
    watchThreadWork();
    return startSharedThreadsSync();
  }, []);
  return null;
}
