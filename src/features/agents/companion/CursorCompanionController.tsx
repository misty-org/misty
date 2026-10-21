import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect } from "react";
import { followLessons } from "../lessons/lessonSync";
import { startCursorCompanion } from "./cursorCompanionRuntime";

/** Lives only in the signed-in main window. Overlay webviews never receive auth or provider clients. */
export function CursorCompanionController({ accountId }: { accountId: string }) {
  // Lessons follow their chats whether a step came from the cursor or the composer.
  useEffect(() => followLessons(accountId), [accountId]);
  useEffect(() => {
    if (!hasTauriInternals() || !/Mac|Win/.test(navigator.platform)) return;
    return startCursorCompanion(accountId);
  }, [accountId]);
  return null;
}
