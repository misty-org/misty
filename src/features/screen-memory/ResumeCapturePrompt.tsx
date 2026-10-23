import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import { useScreenCaptureStore } from "./useScreenCaptureStore";

/** Asks about capturing again, once, when the person returns after a session ended while they were away. */
export function ResumeCapturePrompt() {
  const waiting = useScreenCaptureStore((s) => s.askToResume);
  const [returned, setReturned] = useState(false);

  useEffect(() => {
    if (!waiting) {
      setReturned(false);
      return;
    }
    const back = () => setReturned(true);
    const events = ["pointerdown", "keydown", "focus"] as const;
    for (const name of events) window.addEventListener(name, back, { once: true });
    return () => {
      for (const name of events) window.removeEventListener(name, back);
    };
  }, [waiting]);

  const store = useScreenCaptureStore.getState;
  return (
    <AlertDialog
      open={waiting && returned}
      onOpenChange={(open) => !open && store().dismissResume()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start capture again?</AlertDialogTitle>
          <AlertDialogDescription>
            Your capture stopped while you were away. Starting again reads the window in front, as
            before, until you stop it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => void store().start()}>Start capture</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
