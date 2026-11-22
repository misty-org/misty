import { useEffect } from "react";
import { followLessons } from "../lessons/lessonSync";
import { companionAvailable, useCompanionOn } from "./companionOn";
import { startCursorCompanion } from "./cursorCompanionRuntime";

export function CursorCompanionController({ accountId }: { accountId: string }) {
  useEffect(() => followLessons(accountId), [accountId]);
  const on = useCompanionOn();
  useEffect(() => {
    if (on !== true || !companionAvailable()) return;
    return startCursorCompanion(accountId);
  }, [accountId, on]);
  return null;
}
