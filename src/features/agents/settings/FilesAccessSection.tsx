import { useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { disk } from "@/features/files";
import { invoke } from "@/shared/platform/nativeInvoke";
import { ErrorState, useNotice } from "@misty/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
} from "@/features/settings";
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
  "Off, agents move what they clean up to Agent trash for you to look over. " +
  "On, they may delete for good, and still ask every time.";

/** Turns the disk grant off (`files_grant_revoke`); turning it on is only ever the native prompt. */
const revokeDiskGrant = () => invoke<void>("files_grant_revoke");

/**
 * What Files and agents may do with this computer's files: the disk grant, and whether agents may
 * delete. Turning either on goes through a native prompt, so nothing in a page can; turning them
 * off is a plain switch. Both live on the device and never sync.
 */
export function FilesAccessSection() {
  const listing = useCachedResource("agents/files-access", readAccess, { persist: "device" });
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
  if (loadFailed)
    return (
      <Section title="Files">
        <ErrorState
          inline
          title="Couldn't read these permissions"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", onClick: () => void listing.reload() }}
        />
      </Section>
    );
  if (access === null)
    return (
      <Section title="Files">
        <DesktopSettingsRowSkeleton label="Files" rows={2} description control="switch" />
      </Section>
    );
  return (
    <Section title="Files">
      <Row
        label="Files can open this computer"
        description={diskLine}
      >
        <SwitchControl
          checked={access.disk}
          disabled={working}
          onChange={(on) => void change(on ? disk.grant : revokeDiskGrant)}
        />
      </Row>
      {access.disk || access.agentDelete ? (
        <Row
          label="Let agents delete files"
          description={deleteLine}
        >
          <SwitchControl
            checked={access.agentDelete}
            disabled={working}
            onChange={(on) => void change(on ? disk.allowAgentDelete : disk.stopAgentDelete)}
          />
        </Row>
      ) : null}
    </Section>
  );
}
