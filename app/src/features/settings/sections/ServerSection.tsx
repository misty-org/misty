import { renewSelfHostEntitlement } from "@/api/self-host/entitlement";
import { readAccountAuthToken, readHostedAccountAuthToken } from "@/features/auth";
import {
  applyDeployment,
  deploymentHostLabel,
  forgetDeployment,
  readKnownDeployments,
  type DeploymentChange,
  type KnownDeployment,
} from "@/features/deployment";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Input } from "@/shared/ui";
import { Check, Cloud, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { settingsDisabledControlClass, settingsIconDangerClass } from "../settingsConstants";
import type { SettingsContentProps } from "../settingsTypes";

export function ServerSection(props: SettingsContentProps) {
  const environment = props.app?.environment;
  const selfHosted = environment?.serverMode === "self_hosted";
  const currentUrl = selfHosted ? (environment?.serverUrl ?? "") : "";
  const [servers, setServers] = useState<KnownDeployment[]>(() => {
    const known = typeof window === "undefined" ? [] : readKnownDeployments();
    if (!selfHosted || !currentUrl || known.some((server) => server.url === currentUrl)) {
      return known;
    }
    return [
      {
        url: currentUrl,
        serverId: environment?.serverDeploymentId ?? null,
        name: environment?.serverName?.trim() || deploymentHostLabel(currentUrl),
      },
      ...known,
    ];
  });
  const [newServerUrl, setNewServerUrl] = useState("");
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const nativeAvailable = hasTauriInternals();

  const switchTo = async (target: DeploymentChange) => {
    if (switchingTo || !nativeAvailable) return;
    setSwitchingTo(target.url ?? "hosted");
    setNotice("Verifying the connection. Misty restarts once it is saved…");
    try {
      await applyDeployment(target);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change the Misty server.");
      setSwitchingTo(null);
    }
  };

  const connectNewServer = () => {
    const url = newServerUrl.trim();
    if (!url) {
      setNotice("Enter a self-hosted server URL before connecting.");
      return;
    }
    void switchTo({ mode: "self_hosted", url });
  };

  const renew = async () => {
    if (switchingTo) return;
    setSwitchingTo("verify-access");
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
      setSwitchingTo(null);
    }
  };

  return (
    <>
      <SettingsSectionBlock
        title="Connection"
        description="Choose the Misty server this device uses. Changing servers restarts Misty, and each server keeps its own local data."
      >
        <ServerConnectionRow
          icon={Cloud}
          label="Misty Hosted"
          description="Misty’s managed service"
          current={Boolean(environment && !selfHosted)}
          disabled={!nativeAvailable || switchingTo !== null || props.working}
          working={switchingTo === "hosted"}
          onConnect={() => void switchTo({ mode: "hosted" })}
        />

        {servers.map((server) => {
          const current = selfHosted && currentUrl === server.url;
          return (
            <SettingsRow
              key={server.url}
              label={server.name}
              description={deploymentHostLabel(server.url)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  size="sm"
                  type="button"
                  variant={current ? "outline" : "default"}
                  className={settingsDisabledControlClass}
                  disabled={current || !nativeAvailable || switchingTo !== null || props.working}
                  onClick={() => void switchTo({ mode: "self_hosted", url: server.url })}
                >
                  {current ? (
                    <>
                      <Check size={14} aria-hidden="true" /> Current
                    </>
                  ) : switchingTo === server.url ? (
                    "Connecting…"
                  ) : (
                    "Connect and restart"
                  )}
                </Button>
                {!current ? (
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    className={settingsIconDangerClass}
                    aria-label={`Forget ${server.name}`}
                    disabled={switchingTo !== null || props.working}
                    onClick={() => setServers(forgetDeployment(server.url))}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
          );
        })}

        <SettingsRow
          label="Connect another server"
          description="Use a complete HTTPS API URL. Loopback HTTP is accepted for development."
          last
        >
          <div className="flex w-full min-w-0 items-center justify-end gap-2 max-[760px]:justify-start">
            <Input
              aria-label="Self-hosted server URL"
              className={`min-w-0 flex-1 ${settingsDisabledControlClass}`}
              value={newServerUrl}
              placeholder="https://misty.example.com/api"
              disabled={!nativeAvailable || switchingTo !== null || props.working}
              onChange={(event) => setNewServerUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") connectNewServer();
              }}
            />
            <Button
              size="sm"
              type="button"
              className={`shrink-0 ${settingsDisabledControlClass}`}
              disabled={
                !nativeAvailable || !newServerUrl.trim() || switchingTo !== null || props.working
              }
              onClick={connectNewServer}
            >
              {switchingTo === newServerUrl.trim() ? "Connecting…" : "Connect and restart"}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSectionBlock>

      {selfHosted ? (
        <SettingsSectionBlock title="Access">
          <SettingsRow
            label="Subscription verification"
            description="Refresh your private entitlement proof through Misty Hosted without sending this server’s URL or content."
            last
          >
            <Button
              size="sm"
              type="button"
              variant="outline"
              className={settingsDisabledControlClass}
              disabled={!nativeAvailable || switchingTo !== null || props.working}
              onClick={() => void renew()}
            >
              {switchingTo === "verify-access" ? "Verifying…" : "Verify access"}
            </Button>
          </SettingsRow>
        </SettingsSectionBlock>
      ) : null}

      {notice ? (
        <p className="-mt-2 mb-6 text-[13px] leading-[18px] text-cream-muted" role="status">
          {notice}
        </p>
      ) : null}

      {!nativeAvailable ? (
        <p className="-mt-2 text-[13px] leading-[18px] text-cream-muted">
          Server connections are configured in the Misty desktop app.
        </p>
      ) : null}
    </>
  );
}

function ServerConnectionRow(props: {
  icon: typeof Cloud;
  label: string;
  description: string;
  current: boolean;
  disabled: boolean;
  working: boolean;
  onConnect: () => void;
}) {
  const Icon = props.icon;
  return (
    <SettingsRow label={props.label} description={props.description}>
      <Button
        size="sm"
        type="button"
        variant={props.current ? "outline" : "default"}
        className={settingsDisabledControlClass}
        disabled={props.current || props.disabled}
        onClick={props.onConnect}
      >
        {props.current ? (
          <>
            <Icon size={14} aria-hidden="true" />
            <Check size={14} aria-hidden="true" /> Current
          </>
        ) : props.working ? (
          "Connecting…"
        ) : (
          "Connect and restart"
        )}
      </Button>
    </SettingsRow>
  );
}
