import { useState } from "react";
import { Button, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
  resolveSetting,
  useDevicePreferences,
} from "@/features/settings";
import { PreferenceRow } from "@/features/settings";
import { UninstallDialog } from "./ExtensionDialogs";
import { ExtensionSettingsItem } from "./ExtensionSettingsItem";
import { openStorePage } from "./openStorePage";
import {
  parseInstallations,
  spaceInstallationsRaw,
  storeHomes,
  storeNames,
  updateInstallation,
  useExtensionsStore,
} from "./store";
import type { ExtensionStore, Installation } from "./types";

const stores: { store: ExtensionStore; description: string }[] = [
  { store: "chrome", description: "Extensions made for Chrome." },
  { store: "firefox", description: "Extensions made for Firefox." },
];

/**
 * Settings › Browser › Extensions. People find extensions on the stores' own
 * sites and add them there; this page turns them on and off, sets their
 * access and removes them.
 */
export function ExtensionsSettings() {
  const profile = useDevicePreferences((s) => s.state);
  const runtime = useExtensionsStore();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [removing, setRemoving] = useState<Installation | null>(null);
  const installed = parseInstallations(spaceInstallationsRaw(profile)).filter(
    (item) => item.installed,
  );
  const agentAccess = profile
    ? Boolean(resolveSetting(profile, "extensions.agent_access").value)
    : true;
  async function work(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure("");
    try {
      await action();
    } catch {
      setFailure("The extension could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {runtime.ready && !runtime.supported && (
        <DesktopSettingsNotice>
          Extensions need the Misty desktop app on Windows, or on macOS 15.4 or later.
        </DesktopSettingsNotice>
      )}
      {(failure || runtime.error) && (
        <DesktopSettingsNotice>
          {failure || "Extensions could not be loaded. Try again."}
        </DesktopSettingsNotice>
      )}
      <DesktopSettingsSection
        title="Extensions"
        description="Open a store, then choose Add to Misty on an extension's page. Extensions stay on this device."
      >
        {stores.map(({ store, description }) => (
          <DesktopSettingsRow key={store} label={storeNames[store]} description={description}>
            <Button variant="outline" onClick={() => openStorePage(storeHomes[store])}>
              Open
            </Button>
          </DesktopSettingsRow>
        ))}
        <PreferenceRow
          id="extensions.agent_access"
          description="Agents can use the extensions you allow below, within their existing browser access."
        />
      </DesktopSettingsSection>
      {!runtime.ready && installed.length > 0 ? (
        <SkeletonList label="Extensions" rows={Math.min(installed.length, 4)} trailing />
      ) : (
        installed.map((item) => (
          <ExtensionSettingsItem
            key={item.id}
            item={item}
            local={runtime.states.find((state) => state.id === item.id)}
            busy={busy}
            agentAccess={agentAccess}
            work={work}
            onRemove={setRemoving}
          />
        ))
      )}
      <UninstallDialog
        removing={removing}
        busy={busy}
        onClose={() => setRemoving(null)}
        onUninstall={(removing) =>
          void work(async () => {
            await updateInstallation(removing.id, { installed: false, enabled: false });
            setRemoving(null);
          })
        }
      />
    </>
  );
}
