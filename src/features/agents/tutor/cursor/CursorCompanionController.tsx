import { useEffect } from "react";
import { followLessons } from "../lessons/lessonSync";
import { followTutorJobs } from "../tutorRuns";
import { companionAvailable, useCompanionOn } from "./companionOn";
import { startCursorCompanion } from "./cursorCompanionRuntime";

/** Lives only in the signed-in main window. Overlay webviews never receive auth or provider clients. */
export function CursorCompanionController({ accountId }: { accountId: string }) {
  // Lessons follow their chats whether a step came from the cursor or the composer.
  useEffect(() => followLessons(accountId), [accountId]);
  // Tutor's guides, flashcards and notes are read from their runs' replies.
  useEffect(() => followTutorJobs(accountId), [accountId]);
  // Turning the cursor tutor off stops it: no overlay, and the talk shortcut does nothing.
  const on = useCompanionOn();
  useEffect(() => {
    if (on !== true || !companionAvailable()) return;
    return startCursorCompanion(accountId);
  }, [accountId, on]);
  return null;
}
