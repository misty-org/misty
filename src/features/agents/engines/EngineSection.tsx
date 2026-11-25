import { Download } from "lucide-react";
import {
  DesktopSettingsRow as Row,
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
      <EmptyState
        inline
        title="Install an engine Misty can use"
        line="Misty's own work needs an engine that takes images, Misty's tools and searches the web, such as Claude Code or Codex."
        action={{
          label: "Install an engine",
          icon: Download,
          onClick: () => openAgentsHub("clis"),
        }}
      />
    );
  return (
    <Row label="Default engine" description="Runs Tutor and everything else Misty does for you.">
      <DropdownControl
        value={engine?.id ?? ""}
        options={choices.map((item) => ({ value: item.id, label: item.name }))}
        disabled={working || !prefsReady || !ready}
        onValueChange={(next) => void setDefaultEngine(next)}
      />
    </Row>
  );
}
