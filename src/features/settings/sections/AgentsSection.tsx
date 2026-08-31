import { selectAgentPreferences } from "../store/preferences";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";

export function AgentsSection(props: SettingsContentProps) {
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
    </>
  );
}

function agentScopesPayload(
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
