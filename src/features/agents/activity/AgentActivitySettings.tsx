import { useCallback, useEffect, useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, useNotice } from "@/shared/ui";
import { useProjectsHome, useProjectsHomePath } from "../shared-folders/projectsHome";
import { activityApi } from "./activityApi";
import { forgetStepPictures } from "./useRunSteps";

/**
 * The steps each run took and the pictures of the pages it worked on, kept on this computer for
 * 90 days for the Activity page. Clearing them leaves the runs themselves and their chats.
 */
export function AgentActivitySettings() {
  const [state, setState] = useState<"" | "clearing" | "cleared" | "failed">("");
  const native = hasTauriInternals();
  const clear = async () => {
    const sure = await confirmAction(
      "Clear every step your agents took and the pictures of the pages they worked on? Their chats stay. This can't be undone.",
      "Clear agent steps",
    );
    if (!sure) return;
    setState("clearing");
    try {
      await activityApi.clear();
      forgetStepPictures();
      setState("cleared");
    } catch {
      setState("failed");
    }
  };
  return (
    <DesktopSettingsSection title="Agent activity">
      <DesktopSettingsRow
        label="Clear agent steps"
        description={
          !native
            ? "Available in the desktop app."
            : state === "cleared"
              ? "Steps and pictures cleared."
              : state === "failed"
                ? "They couldn't be cleared. Try again."
                : "Each run's steps and page pictures, kept on this computer for 90 days."
        }
      >
        <Button disabled={!native || state === "clearing"} onClick={() => void clear()}>
          {state === "clearing" ? "Clearing" : "Clear steps"}
        </Button>
      </DesktopSettingsRow>
      <ProjectsHomeRow native={native} />
      <ScratchFoldersRow native={native} />
    </DesktopSettingsSection>
  );
}

/** Where "Open in Code" makes a chat's project, chosen in the system's dialog. */
function ProjectsHomeRow({ native }: { native: boolean }) {
  const path = useProjectsHomePath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const choose = () => {
    setBusy(true);
    void useProjectsHome
      .getState()
      .choose()
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <DesktopSettingsRow
      label="Projects folder"
      description={
        !native
          ? "Available in the desktop app."
          : path || "Where a chat's project goes when it opens in Code. None chosen yet."
      }
    >
      <Button disabled={!native || busy} onClick={choose}>
        {path ? "Change…" : "Choose…"}
      </Button>
    </DesktopSettingsRow>
  );
}

/** How much room chats' scratch folders take, as native code counts it. */
interface ScratchUsage {
  bytes: number;
  folders: number;
  /** Scratch folders whose chat is gone. */
  leftBehind: number;
}

const sizeText = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : bytes >= 1e3
        ? `${Math.round(bytes / 1e3)} KB`
        : `${bytes} B`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function usageLine(usage: ScratchUsage): string {
  const size = `${sizeText(usage.bytes)} in ${count(usage.folders, "folder", "folders")}`;
  if (!usage.leftBehind) return `${size}.`;
  return `${size}, ${usage.leftBehind} of them left by deleted chats.`;
}

/**
 * The folders chats without a project work in, each deleted with its chat. Clearing removes the
 * ones whose chat is already gone, which a chat deleted elsewhere can leave behind.
 */
function ScratchFoldersRow({ native }: { native: boolean }) {
  const [usage, setUsage] = useState<ScratchUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const read = useCallback(() => {
    if (!native) return;
    void invoke<ScratchUsage>("chat_scratch_usage")
      .then((next) => {
        setUsage(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [native]);
  useEffect(read, [read]);
  const clear = async () => {
    if (!usage?.leftBehind) return;
    const sure = await confirmAction(
      "Delete the scratch folders of chats you already deleted, with every file in them? " +
        "This can't be undone.",
      "Clear scratch folders",
    );
    if (!sure) return;
    setClearing(true);
    try {
      await invoke<number>("chat_scratch_clear");
    } catch {
      setFailed(true);
    } finally {
      setClearing(false);
      read();
    }
  };
  return (
    <DesktopSettingsRow
      label="Chat scratch folders"
      description={
        !native
          ? "Available in the desktop app."
          : failed
            ? "Their size couldn't be read. Try again."
            : usage
              ? usageLine(usage)
              : "Where chats without a project work, each deleted with its chat."
      }
    >
      <Button disabled={!native || clearing || !usage?.leftBehind} onClick={() => void clear()}>
        Clear
      </Button>
    </DesktopSettingsRow>
  );
}
