import { publicBetaFeatureEnabled } from "@/features/launch";
import type { AiRecapRecord, AiUserSettings } from "@/features/ai-surface/api";
import {
  Button,
  Input,
  mistyRoadmapUrl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/shared/ui";
import type { Dispatch, SetStateAction } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { settingsDisabledControlClass } from "../settingsConstants";
import { recapSurfaces } from "./mistySettingsConfig";

type MistyBriefingsSectionProps = {
  working: boolean;
  settings: AiUserSettings | null;
  recapSurface: AiRecapRecord["surface_id"];
  setRecapSurface: (surface: AiRecapRecord["surface_id"]) => void;
  recapDraft: AiRecapRecord;
  setRecapDraft: Dispatch<SetStateAction<AiRecapRecord>>;
  onSave: () => void;
};

export function MistyBriefingsSection(props: MistyBriefingsSectionProps) {
  if (!publicBetaFeatureEnabled("recurringBriefings")) {
    return (
      <SettingsSectionBlock
        title="Recurring briefings"
        description="Personal scheduled briefings are being prepared for a future Misty release."
      >
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 py-3.5">
          <span className="text-[13px] text-cream-muted">coming soon...</span>
          <a
            className={
              "text-[13px] text-cream underline underline-offset-4 hover:text-cream-bright " +
              "focus-visible:rounded-sm focus-visible:outline-none " +
              "focus-visible:ring-2 focus-visible:ring-charcoal-active"
            }
            href={mistyRoadmapUrl}
            target="_blank"
            rel="noreferrer"
          >
            View roadmap
          </a>
        </div>
      </SettingsSectionBlock>
    );
  }

  const disabled = props.working || props.settings?.enabled === false;
  const { recapDraft } = props;

  return (
    <SettingsSectionBlock
      title="Recurring briefings"
      description={
        "Personal briefings run only on an explicit schedule, use content you can still access, " +
        "and appear natively on the selected surface. They are off by default."
      }
    >
      <SettingsRow label="Deliver to">
        <Select
          value={props.recapSurface}
          disabled={disabled}
          onValueChange={(value) => props.setRecapSurface(value as AiRecapRecord["surface_id"])}
        >
          <SelectTrigger
            aria-label="Briefing destination"
            className={`w-44 ${settingsDisabledControlClass}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recapSurfaces.map((surface) => (
              <SelectItem key={surface.id} value={surface.id}>
                {surface.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Schedule">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select
            value={recapDraft.enabled ? recapDraft.cadence : "off"}
            disabled={disabled}
            onValueChange={(value) =>
              props.setRecapDraft((current) => ({
                ...current,
                enabled: value !== "off",
                cadence: value === "weekly" ? "weekly" : "daily",
              }))
            }
          >
            <SelectTrigger
              aria-label="Briefing cadence"
              className={`w-32 ${settingsDisabledControlClass}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
          {recapDraft.enabled && recapDraft.cadence === "weekly" ? (
            <Select
              value={String(recapDraft.weekday)}
              disabled={disabled}
              onValueChange={(value) =>
                props.setRecapDraft((current) => ({
                  ...current,
                  weekday: Number(value),
                }))
              }
            >
              <SelectTrigger
                aria-label="Briefing weekday"
                className={`w-32 ${settingsDisabledControlClass}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                  (day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          ) : null}
          {recapDraft.enabled ? (
            <Input
              aria-label="Briefing time"
              type="time"
              className={`w-28 ${settingsDisabledControlClass}`}
              value={recapDraft.local_time}
              disabled={disabled}
              onChange={(event) =>
                props.setRecapDraft((current) => ({
                  ...current,
                  local_time: event.target.value,
                }))
              }
            />
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow
        label="Briefing focus"
        description={`Runs in ${recapDraft.timezone}. Scheduled outputs are personal and cite their source objects.`}
        last
      >
        <div className="w-full max-w-md space-y-2">
          <Textarea
            aria-label="Briefing focus"
            className={settingsDisabledControlClass}
            rows={3}
            maxLength={8000}
            disabled={disabled}
            value={recapDraft.prompt}
            onChange={(event) =>
              props.setRecapDraft((current) => ({
                ...current,
                prompt: event.target.value,
              }))
            }
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-cream-muted">
              {recapDraft.next_run_at
                ? `Next: ${new Date(recapDraft.next_run_at).toLocaleString()}`
                : "No run is scheduled"}
            </span>
            <Button
              type="button"
              size="sm"
              className={settingsDisabledControlClass}
              disabled={disabled || !recapDraft.prompt.trim()}
              onClick={props.onSave}
            >
              Save briefing
            </Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSectionBlock>
  );
}
