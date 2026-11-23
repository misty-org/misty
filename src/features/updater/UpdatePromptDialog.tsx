import { reserveMistyUpdate } from "@/features/app-windows";
import { MistyMarkdown } from "@/features/agents";
import { relaunch } from "@/shared/platform/relaunch";
import type { Update } from "@tauri-apps/plugin-updater";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  Text,
} from "@misty/ui";
import { rememberReleaseNotes } from "./release_notes";
import {
  applyUpdateProgress,
  EMPTY_UPDATE_PROGRESS,
  readableUpdateError,
  type UpdateProgress,
} from "./update_progress";

export function UpdatePromptDialog({ update, onLater }: { update: Update; onLater: () => void }) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<UpdateProgress>(EMPTY_UPDATE_PROGRESS);
  const notes = update.body?.trim();

  async function install() {
    if (installing) return;
    setInstalling(true);
    setError("");
    setProgress(EMPTY_UPDATE_PROGRESS);
    let release = () => {};
    try {
      release = reserveMistyUpdate();
      rememberReleaseNotes(update);
      await update.downloadAndInstall((event) => {
        setProgress((current) => applyUpdateProgress(current, event));
      });
      await relaunch();
    } catch (cause) {
      setError(readableUpdateError(cause));
      setInstalling(false);
    } finally {
      release();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || installing ? undefined : onLater())}>
      <DialogContent aria-describedby={undefined} size="lg" layout="scroll" hideClose={installing}>
        <DialogHeader>
          <DialogTitle>Misty {update.version} is available</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {notes ? (
            <Text bare as="div" tone="default">
              <MistyMarkdown>{notes}</MistyMarkdown>
            </Text>
          ) : (
            <Text tone="muted">This release came without notes.</Text>
          )}
        </DialogBody>
        <DialogFooter>
          {installing && progress.percent !== null ? (
            <Progress aria-label="Update download progress" value={progress.percent} />
          ) : null}
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button variant="quiet" disabled={installing} onClick={onLater}>
            Later
          </Button>
          <Button variant="primary" autoFocus disabled={installing} onClick={() => void install()}>
            Install and restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
