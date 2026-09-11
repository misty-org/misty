import { activityCategories } from "./activityPolicy";
import { activityAccountKey } from "./activityState";
import { useActivityStore } from "./useActivityStore";
import type { ActivityCategory } from "./types";
import {
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "@/features/settings/components/DesktopSettingsUI";
import { SwitchControl } from "@/features/settings/settingsControls";

export function ActivityNotificationControls() {
  const state = useActivityStore();
  const key = activityAccountKey(state);
  const categories = state.categoriesByAccount[key] ?? {};
  const muted = state.mutedSourcesByAccount[key] ?? [];
  return (
    <>
      <DesktopSettingsSection title="Activity alerts">
        <p className="text-sm text-cream-muted">
          Choose which updates can notify you outside Misty. Activity stays available.
        </p>
        {(Object.entries(activityCategories) as [ActivityCategory, string][]).map(
          ([category, label]) => (
            <DesktopSettingsRow key={category} label={label}>
              <SwitchControl
                disabled={!state.accountId}
                checked={categories[category] !== false}
                onChange={(enabled) => state.setCategoryEnabled(category, enabled)}
              />
            </DesktopSettingsRow>
          ),
        )}
      </DesktopSettingsSection>
      <DesktopSettingsSection title="Muted sources">
        <p className="text-sm text-cream-muted">
          Mute a Space or app from its Activity entry. Required requests stay in Activity without an
          OS alert.
        </p>
        {muted.length ? (
          muted.map((source) => {
            const item = state.allItems.find(
              (entry) => source === `app:${entry.appId}` || source === `space:${entry.spaceId}`,
            );
            const label = source.startsWith("app:")
              ? source.slice(4)
              : (item?.sourceLabel ?? "Muted Space");
            return (
              <DesktopSettingsRow key={source} label={label}>
                <button
                  type="button"
                  className="min-h-11 px-3 text-sm text-cream-muted hover:text-cream-bright"
                  onClick={() => state.setSourceMuted(source, false)}
                >
                  Unmute
                </button>
              </DesktopSettingsRow>
            );
          })
        ) : (
          <p className="text-sm text-cream-muted">No muted Spaces or apps.</p>
        )}
      </DesktopSettingsSection>
    </>
  );
}
