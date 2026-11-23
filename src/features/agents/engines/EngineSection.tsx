import { Download } from "lucide-react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  useDevicePreferences,
  useSettingsStore,
} from "@/features/settings";
import { EmptyState } from "@misty/ui";
import { DropdownControl } from "../../settings/SettingsControls";
import { openAgentsHub } from "../hub/agents_hub_store";
import { setDefaultEngine, useDefaultEngine } from "./default_engine";

export function EngineSection() {
  const { engine, choices, ready } = useDefaultEngine();
  const working = useSettingsStore((state) => state.working);
  const prefsReady = useDevicePreferences((state) => state.ready);
  if (ready && !choices.length)
    return (
      <Section title="Engine">
        <EmptyState
          title="Install an engine Misty can use"
          line="Misty's own work needs an engine that takes images, Misty's tools and searches the web, such as Claude Code or Codex."
          action={{
            label: "Install an engine",
            icon: Download,
            onClick: () => openAgentsHub("clis"),
          }}
        />
      </Section>
    );
  return (
    <Section title="Engine">
      <Row
        label="Default engine"
        description="Runs the Lab, Tutor and everything else Misty does for you."
      >
        <DropdownControl
          value={engine?.id ?? ""}
          options={choices.map((item) => ({ value: item.id, label: item.name }))}
          disabled={working || !prefsReady || !ready}
          className="w-60"
          onValueChange={(next) => void setDefaultEngine(next)}
        />
      </Row>
    </Section>
  );
}
