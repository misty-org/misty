import { reserveMistyUpdate } from "@/features/app-windows";
import { relaunch } from "@/shared/platform/relaunch";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
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

type Stage = "checking" | "ready" | "installing" | "failed";

export function UpdateRequiredDialog({ minimum }: { minimum: string }) {
  const [stage, setStage] = useState<Stage>("checking");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<UpdateProgress>(EMPTY_UPDATE_PROGRESS);

  const look = useCallback(async () => {
    setStage("checking");
    setError("");
    if (!hasTauriInternals()) {
      setError("Updates are not configured in this development build.");
      setStage("failed");
      return;
    }
    try {
      const found = await check({ timeout: 30_000 });
      setUpdate(found);
      if (found) {
        setStage("ready");
        return;
      }
      setError("Misty couldn't find the update yet. Try again in a few minutes.");
    } catch (cause) {
      setError(readableUpdateError(cause));
    }
    setStage("failed");
  }, []);

  useEffect(() => {
    void look();
  }, [look]);

  async function install() {
    if (!update || stage !== "ready") return;
    setStage("installing");
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
      setStage("ready");
    } finally {
      release();
    }
  }

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent aria-describedby={undefined} hideClose>
        <DialogHeader>
          <DialogTitle>Update Misty</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text wrap tone="default">
            {minimum
              ? `This server needs Misty ${minimum} or later.`
              : "This server needs a newer version of Misty."}
          </Text>
        </DialogBody>
        <DialogFooter>
          {stage === "installing" && progress.percent !== null ? (
            <Progress aria-label="Update download progress" value={progress.percent} />
          ) : null}
          {error ? <Text tone="danger">{error}</Text> : null}
          {stage === "failed" ? (
            <Button variant="quiet" onClick={() => void look()}>
              Try again
            </Button>
          ) : null}
          <Button
            variant="primary"
            autoFocus
            disabled={stage !== "ready"}
            onClick={() => void install()}
          >
            Install and restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
