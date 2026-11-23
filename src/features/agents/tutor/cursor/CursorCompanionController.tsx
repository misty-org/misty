import { useEffect } from "react";
import { followLessons } from "../lessons/lesson_sync";
import { companionAvailable, useCompanionOn } from "./companion_on";
import { startCursorCompanion } from "./cursor_companion_runtime";

export function CursorCompanionController({ accountId }: { accountId: string }) {
  useEffect(() => followLessons(accountId), [accountId]);
  const on = useCompanionOn();
  useEffect(() => {
    if (on !== true || !companionAvailable()) return;
    return startCursorCompanion(accountId);
  }, [accountId, on]);
  return null;
}
