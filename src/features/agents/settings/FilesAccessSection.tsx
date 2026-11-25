import { useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { disk } from "@/features/files";
import { invoke } from "@/shared/platform/native_invoke";
import { ErrorState, useNotice } from "@misty/ui";
import { DesktopSettingsRow as Row, DesktopSettingsRowSkeleton } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { SwitchControl } from "../../settings/SettingsControls";

interface FilesAccess {
  disk: boolean;
  agentDelete: boolean;
}

async function readAccess(): Promise<FilesAccess> {
  const [granted, agentDelete] = await Promise.all([disk.granted(), disk.agentDeleteOn()]);
  return { disk: granted, agentDelete };
}

const diskLine =
  "Files shows and changes what your user can reach, never Misty's data or your keychains. " +
  "Agents reach it too and ask before changing anything.";
const deleteLine =
  "Off, agents move what they clean up to the trash for you to look over. " +
  "On, they may delete for good, and still ask every time.";

const revokeDiskGrant = () => invoke<void>("files_grant_revoke");

export function FilesAccessSection() {
  const native = hasTauriInternals();
  const listing = useCachedResource(native ? "agents/files-access" : null, readAccess, {
    persist: "device",
  });
  const access = listing.data ?? null;
  const loadFailed = !listing.data && !listing.loading && Boolean(listing.error);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const change = async (work: () => Promise<unknown>) => {
    setWorking(true);
    setError("");
    try {
      await work();
      await listing.reload();
    } catch {
      setError("That couldn’t be changed. Try again.");
    } finally {
      setWorking(false);
    }
  };
  if (!native) return null;
  if (loadFailed)
    return (
      <ErrorState
        inline
        title="Couldn't read these permissions"
        line="Something went wrong on this computer. Try again in a moment."
        action={{ label: "Try again", onClick: () => void listing.reload() }}
      />
    );
  if (access === null)
    return <DesktopSettingsRowSkeleton label="Disk" rows={2} description control="switch" />;
  return (
    <>
      <Row label="Files can open this computer" description={diskLine}>
        <SwitchControl
          checked={access.disk}
          disabled={working}
          onChange={(on) => void change(on ? disk.grant : revokeDiskGrant)}
        />
      </Row>
      {access.disk || access.agentDelete ? (
        <Row label="Let agents delete files" description={deleteLine}>
          <SwitchControl
            checked={access.agentDelete}
            disabled={working}
            onChange={(on) => void change(on ? disk.allowAgentDelete : disk.stopAgentDelete)}
          />
        </Row>
      ) : null}
    </>
  );
}
