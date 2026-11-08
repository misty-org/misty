import type { AiMemoryRecord, AiUserSettings } from "../runs/invocations/aiSettingsTypes";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { SwitchControl } from "../../settings/SettingsControls";
import { settingsDisabledControlClass } from "../../settings/settingsConstants";

/** Misty's memory page: whether it may remember details, and each one it remembers. */
export function MistyRememberedSection({
  settings,
  working,
  memories,
  onMemoryEnabledChange,
  onForget,
}: {
  settings: AiUserSettings | null;
  working: boolean;
  memories: AiMemoryRecord[];
  onMemoryEnabledChange: (enabled: boolean) => void;
  onForget: (memoryId: string) => void;
}) {
  return (
    <SettingsSectionBlock title="Context">
      <SettingsRow
        label="Remembered context"
        description="Only what you ask Misty to remember. Private to you."
        muted={!settings || !settings.enabled}
      >
        <SwitchControl
          checked={settings?.memory_enabled ?? false}
          disabled={!settings || working || !settings.enabled}
          onChange={onMemoryEnabledChange}
        />
      </SettingsRow>
      {memories.length === 0 ? (
        <p className="py-2 text-ui text-cream-muted">
          Misty remembers a detail only when you ask it to.
        </p>
      ) : (
        memories.map((memory) => (
          <SettingsRow
            key={memory.id}
            label={memory.content}
            description={`${
              memory.kind === "instruction"
                ? "Standing instruction"
                : memory.kind === "preference"
                  ? "Preference"
                  : "Detail"
            } · ${memory.space_id ? "used only in its Space" : "available across Misty"}`}
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={settingsDisabledControlClass}
              disabled={working}
              aria-label={`Forget ${memory.content}`}
              onClick={() => onForget(memory.id)}
            >
              Forget
            </Button>
          </SettingsRow>
        ))
      )}
    </SettingsSectionBlock>
  );
}
