import { renewSelfHostEntitlement } from "@/api/self-host/entitlement";
import { readAccountAuthToken, readHostedAccountAuthToken } from "@/features/auth";
import { applyDeployment } from "@/features/deployment";
import { Button, Input } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, CopyableValueText, SwitchControl, ValueText } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function AdvancedSection(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Deployment">
        <SelfHostedConnectionSettings {...props} />
      </SettingsSectionBlock>

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

      <SettingsSectionBlock title="Storage">
        <SettingsRow
          label="Remote runtime"
          description="Provider requests run through the embedded Misty runtime."
        >
          <ValueText
            value={
              props.app?.storageRuntime.ready
                ? `Ready (${props.app.storageRuntime.version})`
                : (props.app?.storageRuntime.error ?? "Loading")
            }
            muted={!props.app?.storageRuntime.ready}
          />
        </SettingsRow>
        <SettingsRow label="App version" description="The installed Misty build version.">
          <ValueText value={props.app?.version ?? "Loading"} muted={!props.app?.version} />
        </SettingsRow>
        <SettingsRow
          label="Config path"
          description="Where Misty stores local configuration files on this device."
        >
          <CopyableValueText
            value={props.app?.environment.configDir ?? "Loading"}
            disabled={!props.app?.environment.configDir}
          />
        </SettingsRow>
        <SettingsRow
          label="Data path"
          description="Where Misty stores local app data on this device."
          last
        >
          <CopyableValueText
            value={props.app?.environment.mistyDir ?? "Loading"}
            disabled={!props.app?.environment.mistyDir}
          />
        </SettingsRow>
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
      setNotice("Verifying the connection. Misty restarts once it is saved…");
      await applyDeployment({ mode, url });
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
        description="Hosted uses Misty's managed service. Self-hosted connects only to the server you configure."
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
          description="Refreshes your private entitlement proof through Misty Hosted without sending this server's URL or content."
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
