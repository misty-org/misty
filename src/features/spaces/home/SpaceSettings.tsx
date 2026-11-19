import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  type SettingsContentProps,
} from "@/features/settings";
import { ChoiceControl } from "@/features/settings/SettingsControls";
import { comingUpDayChoices, comingUpDays } from "./comingUpDays";
import { useHomePreferences } from "./homePreferences";

const dayLabels: Record<(typeof comingUpDayChoices)[number], string> = {
  "7": "1 week",
  "14": "2 weeks",
  "30": "30 days",
};

/**
 * Settings › Space: how the Space's home lays out what is in it, and how far ahead its Coming up
 * card looks. The view and maker filter are the ones the home's own toolbar changes.
 */
export function SpaceSettings(props: SettingsContentProps) {
  const { view, scope } = useHomePreferences((state) => state.value);
  const setHome = useHomePreferences((state) => state.set);
  return (
    <Section title="Home">
      <Row label="View">
        <ChoiceControl
          value={view}
          disabled={props.working}
          options={[
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
          ]}
          onValueChange={(next) =>
            setHome((home) => ({ ...home, view: next === "list" ? "list" : "grid" }))
          }
        />
      </Row>
      <Row label="Show items by">
        <ChoiceControl
          value={scope}
          disabled={props.working}
          options={[
            { value: "all", label: "Everyone" },
            { value: "yours", label: "You" },
          ]}
          onValueChange={(next) =>
            setHome((home) => ({ ...home, scope: next === "yours" ? "yours" : "all" }))
          }
        />
      </Row>
      <Row label="Coming up looks ahead">
        <ChoiceControl
          value={String(comingUpDays(props.document))}
          disabled={props.working}
          options={comingUpDayChoices.map((days) => ({ value: days, label: dayLabels[days] }))}
          onValueChange={(next) => props.onSettingChange("space", "coming_up_days", Number(next))}
        />
      </Row>
    </Section>
  );
}
