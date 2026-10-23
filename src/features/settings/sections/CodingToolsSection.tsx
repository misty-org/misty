import { hasTauriInternals } from "@/shared/platform/tauri";
import { codingTools } from "@/features/agents";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { definitionById, fromLegacy } from "../devicePreferences/registry";
import { useDevicePreferences } from "../devicePreferences/store";
import { DropdownControl } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

function useDeviceSetting(id: string) {
  const definition = definitionById.get(id)!;
  const store = useSettingsStore();
  const ready = useDevicePreferences((state) => state.ready);
  const section = store.settings?.document[definition.section] as
    Record<string, unknown> | undefined;
  return {
    label: definition.label,
    value: String(fromLegacy(definition, section?.[definition.key]) || "none"),
    disabled: store.working || !ready,
    set: (next: string) => void store.updateSetting(definition.section, definition.key, next),
  };
}

const toolOptions = (none: string) => [
  { value: "none", label: none },
  ...codingTools.map((tool) => ({ value: tool.id, label: tool.name })),
];

/** Routing choices for coding tools on this device. */
export function CodingToolsSection() {
  const defaultTool = useDeviceSetting("agents.coding_default_tool");
  const fallback = useDeviceSetting("agents.coding_fallback_tool");
  const cap = useDeviceSetting("agents.coding_usage_cap");
  if (!hasTauriInternals()) return null;

  return (
    <Section title="Routing">
      <Row label={defaultTool.label} description="Agents hand coding to this tool first.">
        <DropdownControl
          value={defaultTool.value}
          disabled={defaultTool.disabled}
          options={toolOptions("None")}
          onValueChange={defaultTool.set}
        />
      </Row>
      <Row
        label={fallback.label}
        description="Used when the default is missing, signed out, at its limit or can’t work in the chat’s mode."
      >
        <DropdownControl
          value={fallback.value}
          disabled={fallback.disabled}
          options={toolOptions("No fallback")}
          onValueChange={fallback.set}
        />
      </Row>
      <Row
        label={cap.label}
        description="Agents stop using a tool once it has used this much of its own weekly limit."
      >
        <DropdownControl
          value={cap.value}
          disabled={cap.disabled}
          options={[
            { value: "none", label: "No limit" },
            ...["25", "35", "50", "75"].map((value) => ({
              value,
              label: `${value}% of each tool’s weekly limit`,
            })),
          ]}
          onValueChange={cap.set}
        />
      </Row>
    </Section>
  );
}
