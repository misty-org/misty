import {
  defaultAgentModelId,
  selectedAgentModelName,
  usePersonalAgentsStore,
} from "@/features/agents";
import { InstallerCard } from "@/features/installer";
import { selectAgentPreferences } from "./store/preferences";
import { DesktopUpdaterSettings } from "@/features/updater";
import { Badge } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "./components/DesktopSettingsUI";

import { defaultFileActionOptions, scaleOptions, terminalOptions } from "./settingsConstants";
import {
  booleanSetting,
  CopyableValueText,
  numberSetting,
  SelectControl,
  stringSetting,
  SwitchControl,
  ValueText,
  WorkspaceRootControl,
} from "./settingsControls";
import type { SettingsContentProps } from "./settingsTypes";
export function GeneralSettings(props: SettingsContentProps) {
  const launchOnLoginUnsupported = props.launchOnLogin?.supported === false;
  const launchOnLoginEnabled = props.launchOnLogin
    ? props.launchOnLogin.enabled
    : booleanSetting(props.document, "general", "launch_on_login", false);
  const workspaceRoot = stringSetting(props.document, "general", "preferred_workspace_root", "");
  return (
    <>
      <SettingsSectionBlock title="Startup">
        <SettingsRow
          label="Launch on login"
          description={
            launchOnLoginUnsupported
              ? "Unavailable on this platform."
              : "Start Misty automatically when you sign in to this device."
          }
          last
        >
          <SwitchControl
            checked={launchOnLoginEnabled}
            disabled={props.working || launchOnLoginUnsupported}
            onChange={(value) => props.onSettingChange("general", "launch_on_login", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Behavior">
        <SettingsRow
          label="Confirm destructive actions"
          description="Ask before delete, empty trash, and other irreversible actions."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "confirm_destructive_actions", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "confirm_destructive_actions", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Default file action"
          description="Choose what a primary file interaction should do."
        >
          <SelectControl
            value={numberSetting(props.document, "general", "default_file_action_index", 0)}
            options={defaultFileActionOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "default_file_action_index", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Open links externally"
          description="Send external links to the system browser instead of handling them in-app."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "open_links_externally", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "open_links_externally", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Defaults">
        <SettingsRow
          label="Files starting folder"
          description="Choose the default starting location for file browsing."
        >
          <WorkspaceRootControl
            value={workspaceRoot}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("general", "preferred_workspace_root", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Terminal app"
          description="Choose which terminal opens from the Files toolbar."
          last
        >
          <SelectControl
            value={Math.max(
              0,
              terminalOptions.indexOf(
                stringSetting(
                  props.document,
                  "general",
                  "preferred_terminal_app",
                  "System Default",
                ),
              ),
            )}
            options={terminalOptions}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange(
                "general",
                "preferred_terminal_app",
                terminalOptions[value] ?? "System Default",
              )
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}

export function AppSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Updates">
        {/* Relocated from the old Account surface, which was this component's
            only consumer. App updates are a desktop concern, not an account
            one. */}
        <DesktopUpdaterSettings />
        <SettingsRow
          label="Check for updates automatically"
          description="Look for a new Misty version on launch. You can always check manually above."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "general", "auto_update_enabled", true)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("general", "auto_update_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Runtime">
        <div className="bg-charcoal-card p-4">
          <InstallerCard embedded variant="compact" />
        </div>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Support Info">
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

export function AgentSettings(props: SettingsContentProps) {
  const agent = selectAgentPreferences(props.document);
  const updateScope = (
    key: "files_allowed" | "cleanup_allowed" | "search_allowed",
    value: boolean,
  ) => {
    props.onSettingChange("agent", "scopes", agentScopesPayload(agent, key, value));
  };

  return (
    <>
      <SettingsSectionBlock title="Agents">
        <SettingsRow
          label="Enable Agents"
          description="Show Agents and let them help with files and folders."
          last
        >
          <SwitchControl
            checked={agent.enabled}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("agent", "enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Permissions">
        <SettingsRow
          label="Files"
          description="Allow Agents to inspect and organize files in the active Files folder."
        >
          <SwitchControl
            checked={agent.scopes.filesAllowed}
            disabled={props.working || !agent.enabled}
            onChange={(value) => updateScope("files_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Cleanup"
          description="Allow Agents to identify clutter and propose cleanup actions."
        >
          <SwitchControl
            checked={agent.scopes.cleanupAllowed}
            disabled={props.working || !agent.enabled}
            onChange={(value) => updateScope("cleanup_allowed", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Search"
          description="Allow Agents to search indexed files and folders."
          last
        >
          <SwitchControl
            checked={agent.scopes.searchAllowed}
            disabled={props.working || !agent.enabled}
            onChange={(value) => updateScope("search_allowed", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <AgentDefaultModelSettings {...props} />
    </>
  );
}

/**
 * The model a new chat starts on. Per-agent and per-chat overrides already
 * existed; only the global default was hardcoded.
 */
export function AgentDefaultModelSettings(props: SettingsContentProps) {
  const models = usePersonalAgentsStore((state) => state.models);
  const configured = defaultAgentModelId(props.document);
  const options = models.length > 0 ? models : [];
  const selectedIndex = Math.max(
    0,
    options.findIndex((model) => model.id === configured),
  );

  if (options.length === 0) return null;

  return (
    <SettingsSectionBlock title="Model">
      <SettingsRow
        label="Default model"
        description="Used for new chats that do not pick their own model. Agents with a configured model are unaffected."
        last
      >
        <SelectControl
          value={selectedIndex}
          options={options.map((model) => selectedAgentModelName(model.id))}
          disabled={props.working}
          onChange={(value) => {
            const model = options[value];
            if (!model) return;
            props.onSettingChange("agent", "default_model_id", model.id);
          }}
        />
      </SettingsRow>
    </SettingsSectionBlock>
  );
}

export function agentScopesPayload(
  agent: ReturnType<typeof selectAgentPreferences>,
  key: "files_allowed" | "cleanup_allowed" | "search_allowed",
  value: boolean,
): Record<string, unknown> {
  return {
    files_allowed: agent.scopes.filesAllowed,
    cleanup_allowed: agent.scopes.cleanupAllowed,
    search_allowed: agent.scopes.searchAllowed,
    [key]: value,
  };
}

export function AppearanceSettings(props: SettingsContentProps) {
  return (
    <>
      <SettingsSectionBlock title="Theme">
        <SettingsRow
          label="Visual style"
          description="Misty uses one high-contrast warm charcoal theme across every workspace."
        >
          <Badge variant="secondary">Warm charcoal</Badge>
        </SettingsRow>
        <SettingsRow
          label="UI scale"
          description="Adjust overall interface scale and density."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "appearance", "ui_scale_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "ui_scale_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Layout">
        <SettingsRow
          label="Compact mode"
          description="Reduce padding and spacing in file-heavy views."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "compact_mode_enabled", false)}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "compact_mode_enabled", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Typography">
        <SettingsRow
          label="Font size"
          description="Choose the baseline text size Misty should use."
          last
        >
          <SelectControl
            value={numberSetting(props.document, "appearance", "font_size_index", 1)}
            options={scaleOptions}
            disabled={props.working}
            onChange={(value) => props.onSettingChange("appearance", "font_size_index", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock title="Media">
        <SettingsRow
          label="Thumbnail previews"
          description="Show preview-rich file rows where supported."
        >
          <SwitchControl
            checked={booleanSetting(
              props.document,
              "appearance",
              "thumbnail_previews_enabled",
              true,
            )}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "thumbnail_previews_enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Reduced motion"
          description="Tone down motion and animated transitions."
          last
        >
          <SwitchControl
            checked={booleanSetting(props.document, "appearance", "reduced_motion_enabled", false)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("appearance", "reduced_motion_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
