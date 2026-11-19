import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  type SettingsContentProps,
} from "@/features/settings";
import { SwitchControl } from "@/features/settings/SettingsControls";
import { selectSearchSources } from "./searchSources";

/**
 * Settings › Search: the sources a search asks besides Misty's own places and the Space. Each
 * one left off is never asked, so its results never show.
 */
export function SearchSettings(props: SettingsContentProps) {
  const include = selectSearchSources(props.document);
  const toggle = (key: string, checked: boolean) => (
    <SwitchControl
      checked={checked}
      disabled={props.working}
      onChange={(value) => props.onSettingChange("search", key, value)}
    />
  );
  return (
    <Section title="Sources">
      <Row label="Files in your projects">{toggle("project_files", include.files)}</Row>
      <Row label="Apps to connect">{toggle("apps", include.apps)}</Row>
      <Row label="Past agent sessions">{toggle("agent_sessions", include.sessions)}</Row>
    </Section>
  );
}
