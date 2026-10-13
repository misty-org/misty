import { Button } from "@/shared/ui";
import { DesktopSettingsRow, DesktopSettingsSection } from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { extensionsNative } from "./native";
import { newTabOverride } from "./newTabOverride";
import { openStorePage } from "./openStorePage";
import { permissionLabel } from "./permissions";
import { extensionStore, requestInstall, storeNames, storePage, updateInstallation } from "./store";
import type { Installation, InstalledState } from "./types";

type Work = (action: () => Promise<unknown>) => Promise<void>;

/** What the switch's account-wide intent means on this device right now. */
function runtimeStatus(item: Installation, local?: InstalledState): string {
  if (local?.detail) return local.detail;
  if (!item.enabled) return "Off on all your devices.";
  if (local?.status === "enabled") return "Running on this device.";
  if (local?.status === "needs-review") return "Waiting for you to review its access here.";
  return "Starting on this device.";
}

/** One installed extension's controls in Settings › Browser › Extensions. */
export function ExtensionSettingsItem({
  item,
  local,
  busy,
  agentAccess,
  work,
  onRemove,
}: {
  item: Installation;
  local?: InstalledState;
  busy: boolean;
  agentAccess: boolean;
  work: Work;
  onRemove(item: Installation): void;
}) {
  const store = extensionStore(item.id) ?? "firefox";
  const version = local?.version ?? local?.review?.entry.version;
  const access = [...item.permissions, ...item.hosts];
  return (
    <DesktopSettingsSection
      title={item.name}
      description={`${storeNames[store]}${version ? ` · Version ${version}` : ""}`}
    >
      <DesktopSettingsRow label="Enabled" description={runtimeStatus(item, local)}>
        <SwitchControl
          checked={item.enabled}
          disabled={busy}
          onChange={(value) => void work(() => updateInstallation(item.id, { enabled: value }))}
        />
      </DesktopSettingsRow>
      {local?.status === "needs-review" && (
        <DesktopSettingsRow
          label="Review access"
          description="This version asks for access you haven't approved on this device."
        >
          <Button variant="outline" disabled={busy} onClick={() => requestInstall(item.id)}>
            Review
          </Button>
        </DesktopSettingsRow>
      )}
      <DesktopSettingsRow
        label="Allow in private tabs"
        description="It can work on the sites it's allowed on while you browse privately."
      >
        <SwitchControl
          checked={item.privateAccess}
          disabled={busy || local?.review?.privateAllowed === false}
          onChange={(value) =>
            void work(async () => {
              if (value) await extensionsNative.approve(item.guid, [], [], true);
              await updateInstallation(item.id, { privateAccess: value });
            })
          }
        />
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Allow agents"
        description={
          agentAccess
            ? "Agents can use it within the browser access you give them."
            : "Agents can't use extensions until Allow agents to use extensions is on."
        }
        muted={!agentAccess}
      >
        <SwitchControl
          checked={item.agentAccess}
          disabled={busy || !agentAccess}
          onChange={(value) => void work(() => updateInstallation(item.id, { agentAccess: value }))}
        />
      </DesktopSettingsRow>
      {local?.newTab && (
        <DesktopSettingsRow
          label="New tab page"
          description={
            newTabOverride() === local.newTab
              ? "New tabs open this extension's page while it's on."
              : "Another extension's page opens in new tabs. The one added last is used."
          }
        >
          <Button variant="outline" onClick={() => openStorePage(local.newTab!)}>
            Open
          </Button>
        </DesktopSettingsRow>
      )}
      {local?.review?.hasOptions && (
        <DesktopSettingsRow label="Extension settings" description="Opens the extension's own options.">
          <Button
            variant="outline"
            disabled={busy || local.status !== "enabled"}
            onClick={() => void work(() => extensionsNative.options(item.id))}
          >
            Open
          </Button>
        </DesktopSettingsRow>
      )}
      {access.map((permission) => (
        <DesktopSettingsRow
          key={permission}
          label={permissionLabel(permission)}
          description={
            permissionLabel(permission) === permission
              ? "Access it asked for when you added it."
              : permission
          }
        >
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void work(() =>
                updateInstallation(item.id, {
                  permissions: item.permissions.filter((p) => p !== permission),
                  hosts: item.hosts.filter((p) => p !== permission),
                }),
              )
            }
          >
            Remove access
          </Button>
        </DesktopSettingsRow>
      ))}
      <DesktopSettingsRow
        label="Store page"
        description={store === "chrome" ? "Opens it on the Chrome Web Store." : "Opens it on Firefox Add-ons."}
      >
        <Button variant="outline" onClick={() => openStorePage(storePage(item))}>
          Open
        </Button>
      </DesktopSettingsRow>
      <DesktopSettingsRow
        label="Remove extension"
        description="Removes it and its synced data from all your devices."
      >
        <Button variant="outline" disabled={busy} onClick={() => onRemove(item)}>
          Remove
        </Button>
      </DesktopSettingsRow>
    </DesktopSettingsSection>
  );
}
