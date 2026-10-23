import type { AiMemoryRecord, AiUserSettings } from "@/features/ai-surface/api";
import { Button } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SwitchControl } from "../SettingsControls";
import { settingsDisabledControlClass } from "../settingsConstants";

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
    <SettingsSectionBlock
      title="Remembered details"
      description={
        "Misty starts with what you're looking at and the context you attach. Content from pages, mail, " +
        "files, chat and extensions is treated as untrusted data and can't grant capabilities. " +
        "Forgetting a detail removes it from future conversations."
      }
    >
      <SettingsRow
        label="Remembered context"
        description="Misty saves a detail only when you explicitly ask it to remember. Memories stay private to you, even when scoped to a Space."
        muted={!settings || !settings.enabled}
      >
        <SwitchControl
          checked={settings?.memory_enabled ?? false}
          disabled={!settings || working || !settings.enabled}
          onChange={onMemoryEnabledChange}
        />
      </SettingsRow>
      {memories.length === 0 ? (
        <p className="py-2 text-[13px] text-cream-muted">
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
