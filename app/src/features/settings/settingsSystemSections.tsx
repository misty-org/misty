import { inspectSelfHostedServer, saveDeploymentConfiguration } from "@/api/deployment/api";
import { mintSelfHostEntitlement, renewSelfHostEntitlement } from "@/api/self-host/entitlement";
import { saveSelfHostEntitlementProof } from "@/api/self-host/proof";
import { readAccountAuthToken, readHostedAccountAuthToken } from "@/features/auth";
import { useOperationQueueStore } from "@/features/files/explorer";
import { Button, Input } from "@/shared/ui";
import { relaunch } from "@tauri-apps/plugin-process";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "./components/DesktopSettingsUI";
import { defaultTransferProfileId, transferProfileRecords } from "./transferProfiles";

import {
  keymapOptions,
  settingsAssociationRowClass,
  settingsControlButtonCompactClass,
  settingsEmptyClass,
  settingsIconDangerClass,
  settingsInlineActionsClass,
  settingsPrimaryButtonClass,
  settingsReferenceHeaderClass,
  settingsReferenceListClass,
  settingsReferenceRowClass,
  settingsReferenceSpanClass,
  transferBehaviorOptions,
} from "./settingsConstants";
import {
  booleanSetting,
  numberSetting,
  SelectControl,
  SettingsNote,
  stringSetting,
  SwitchControl,
  TextControl,
} from "./settingsControls";
import type { SettingsContentProps } from "./settingsTypes";
export function PrivacySettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Data handling">
        <SettingsRow
          label="Share anonymous usage analytics"
          description="Share first-open, onboarding, and application-session events. No filenames, paths, or content."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_usage_analytics_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_usage_analytics_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Send anonymous crash reports"
          description="Share sanitized unexpected React and Rust errors without file or account data."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "privacy",
              "anonymous_error_reporting_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("privacy", "anonymous_error_reporting_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

/**
 * Transfer performance is a real capability: the Rust queue reads the selected
 * profile for its concurrency and bandwidth limit. What was missing was any
 * call site — the settings UI wrote the profile to disk and nothing applied it.
 *
 * This exposes the built-in presets and actually applies the choice. The old
 * per-field profile editor is gone: it was a lot of surface for values almost
 * nobody tunes, and none of it was wired.
 */
export function TransferPerformanceSettings(props: SettingsContentProps) {
  const profiles = transferProfileRecords(props.document);
  const defaultProfileId = defaultTransferProfileId(props.document);
  const selectedIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === defaultProfileId),
  );
  const setTransferProfile = useOperationQueueStore((state) => state.setTransferProfile);

  if (profiles.length === 0) return null;

  return (
    <SettingsSectionBlock title="Performance">
      <SettingsRow
        label="Transfer performance"
        description="How many files move at once, and whether transfers are bandwidth-limited or checksum-verified."
        last
      >
        <SelectControl
          value={selectedIndex}
          options={profiles.map((profile) => profile.name)}
          disabled={props.working}
          onChange={(value) => {
            const profile = profiles[value];
            if (!profile) return;
            props.onSettingChange("transfer_profiles", "default_profile_id", profile.id);
            void setTransferProfile(profile);
          }}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

export function TransfersSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Default transfer behavior"
          description="Choose how copy and download flows should behave by default."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_transfer_behavior_index", 0)}
            options={transferBehaviorOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_transfer_behavior_index", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <TransferPerformanceSettings {...props} />
    </>
  );
}

export function ShortcutsSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Navigation">
        <SettingsRow
          label="Show shortcut hints"
          description="Display shortcut hints in tooltips and menus where helpful."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Customization">
        <SettingsRow
          label="Keymap preset"
          description="Choose the shortcut style that feels most natural on this device."
        >
          <SelectControl
            value={numberSetting(props.document, "shortcuts", "keymap_index", 0)}
            options={keymapOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("shortcuts", "keymap_index", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Enable custom shortcuts"
          description="Use saved per-command shortcut overrides instead of only Misty's built-in defaults."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "custom_shortcuts_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "custom_shortcuts_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Reference">
        <SettingsNote>
          Review the active bindings Misty has loaded so shortcut behavior is easy to test.
        </SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsReferenceRowClass} ${settingsReferenceHeaderClass}`}>
            <span>Command</span>
            <span>Shortcut</span>
          </div>
          {props.shortcuts.map((binding) => (
            <div className={settingsReferenceRowClass} key={binding.commandId}>
              <span className={settingsReferenceSpanClass}>{binding.commandId}</span>
              <Input
                value={binding.shortcut}
                disabled={props.working}
                onChange={(event) => props.onShortcutChange(binding.commandId, event.target.value)}
              />
            </div>
          ))}
        </div>
        <div className={settingsInlineActionsClass}>
          <Button
            type="button"
            className={settingsPrimaryButtonClass}
            disabled={props.working}
            onClick={() => void props.onSaveShortcuts()}
          >
            Save Changes
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.working}
            onClick={() => void props.onLoad()}
          >
            Reset
          </Button>
        </div>
      </SettingsSectionBlock>
    </>
  );
}

export function AdvancedSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Diagnostics">
        <SettingsRow
          label="Frame pacing overlay"
          description="Show the live idle, light, and heavy pacing state in the top-right corner."
          last
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "advanced",
              "frame_pacing_overlay_enabled",
              false,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("advanced", "frame_pacing_overlay_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Connection">
        <SelfHostedConnectionSettings {...props} />
        <SettingsRow
          label="Extension tools PATH"
          description="Directories Misty searches for tools such as FFmpeg and yt-dlp. Defaults to your macOS login-shell PATH. Enter PATH directories only, separated by colons—not a shell command."
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "extension_tools_path", "")}
            placeholder="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "extension_tools_path", value)}
            wide
          />
        </SettingsRow>
        <SettingsRow
          label="Server address"
          description="The gRPC address Misty uses for local file operations."
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "server_address", "localhost:50051")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "server_address", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Mount path"
          description="The root path Misty should treat as its default mount target."
          last
        >
          <TextControl
            value={stringSetting(props.document, "advanced", "mount_path", ".misty/mnt")}
            disabled={props.working}
            onCommit={(value) => props.onSettingChange("advanced", "mount_path", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Open with associations">
        <SettingsNote>Review remembered apps used by File Explorer.</SettingsNote>
        <div className={settingsReferenceListClass}>
          <div className={`${settingsAssociationRowClass} ${settingsReferenceHeaderClass}`}>
            <span>File</span>
            <span>Application</span>
            <span />
          </div>
          {props.openWithAssociations.map((association) => (
            <div className={settingsAssociationRowClass} key={association.key}>
              <span className={settingsReferenceSpanClass}>{association.key}</span>
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                title={association.applicationPath}
              >
                {association.applicationPath}
              </span>
              <Button
                variant="outline"
                size="icon"
                type="button"
                className={settingsIconDangerClass}
                aria-label={`Remove ${association.key}`}
                disabled={props.working}
                onClick={() => void props.onRemoveOpenWithAssociation(association.key)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          {props.openWithAssociations.length === 0 ? (
            <p className={settingsEmptyClass}>No Open With associations saved.</p>
          ) : null}
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function SelfHostedConnectionSettings(props: SettingsContentProps) {
  const currentMode = props.app?.environment.serverMode ?? "hosted";
  const currentUrl = props.app?.environment.serverUrl ?? "";
  const [mode, setMode] = useState<"hosted" | "self_hosted">(currentMode);
  const [url, setUrl] = useState(currentUrl);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setMode(currentMode);
    setUrl(currentUrl);
  }, [currentMode, currentUrl]);

  const apply = async () => {
    setWorking(true);
    setNotice("");
    try {
      const descriptor = mode === "self_hosted" ? await inspectSelfHostedServer(url) : undefined;
      if (mode === "self_hosted") {
        const entitlement = await mintSelfHostEntitlement(await readHostedAccountAuthToken());
        await saveSelfHostEntitlementProof(entitlement.token);
      }
      await saveDeploymentConfiguration(mode, url, descriptor);
      setNotice("Connection saved. Restarting Misty…");
      await relaunch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change the Misty server.");
    } finally {
      setWorking(false);
    }
  };

  const renew = async () => {
    setWorking(true);
    setNotice("");
    try {
      const entitlement = await renewSelfHostEntitlement(
        await readHostedAccountAuthToken(),
        await readAccountAuthToken(),
      );
      setNotice(`Access verified through ${new Date(entitlement.expires_at).toLocaleString()}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not verify self-host access.");
    } finally {
      setWorking(false);
    }
  };

  const changed = mode !== currentMode || (mode === "self_hosted" && url !== currentUrl);
  return (
    <>
      <SettingsRow
        label="Deployment"
        description="Hosted uses Misty’s managed service. Self-hosted connects only to the server you configure."
      >
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            type="button"
            variant={mode === "hosted" ? "default" : "outline"}
            disabled={working || props.working}
            onClick={() => setMode("hosted")}
          >
            Hosted
          </Button>
          <Button
            size="sm"
            type="button"
            variant={mode === "self_hosted" ? "default" : "outline"}
            disabled={working || props.working}
            onClick={() => setMode("self_hosted")}
          >
            Self-hosted
          </Button>
        </div>
      </SettingsRow>
      {currentMode === "self_hosted" ? (
        <SettingsRow
          label="Subscription verification"
          description="Refreshes your private entitlement proof through Misty Hosted without sending this server’s URL or content."
        >
          <Button
            size="sm"
            type="button"
            variant="outline"
            disabled={working || props.working}
            onClick={() => void renew()}
          >
            {working ? "Verifying…" : "Verify access"}
          </Button>
        </SettingsRow>
      ) : null}
      {mode === "self_hosted" ? (
        <SettingsRow
          label="Self-hosted server URL"
          description="Use a complete HTTPS API URL. Loopback HTTP is accepted for development."
        >
          <Input
            className="w-full max-w-[520px]"
            value={url}
            placeholder="https://misty.example.com/api"
            disabled={working || props.working}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Apply deployment"
        description={
          notice ||
          "Misty verifies a self-hosted server before saving it. Changing deployment restarts the app."
        }
      >
        <Button
          size="sm"
          type="button"
          disabled={!changed || working || props.working}
          onClick={() => void apply()}
        >
          {working ? "Verifying…" : "Save and restart"}
        </Button>
      </SettingsRow>
    </>
  );
}
