// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Settings › Tools › Skills.
 *
 * Three panes, each loading its own data only while it shows:
 *   My skills — installed and local skills (the default)
 *   Discover  — repository discovery and skills.sh search (online, on request)
 *   Usage     — Claude Code invocation counts and the log of changes
 *
 * The page owns only the active tab: state lives in the pane hooks, so switching tabs never
 * fetches another pane's data again.
 */
import { useState } from "react";
import { DesktopSettingsSection as Section } from "@/features/settings";
import { ChoiceGroup } from "@/shared/ui";
import { DiscoverPane } from "./DiscoverPane";
import { InstalledPane } from "./InstalledPane";
import { SkillUsagePane } from "./SkillUsagePane";
import { t } from "./strings";

type SkillTab = "installed" | "discover" | "usage";

export function SkillsSection() {
  const [tab, setTab] = useState<SkillTab>("installed");
  return (
    <Section title="Skills">
      <div>
        <ChoiceGroup
          label="Skills"
          value={tab}
          onChange={setTab}
          options={(["installed", "discover", "usage"] as const).map((id) => ({
            value: id,
            label: t(`tabs.${id}`),
          }))}
        />
      </div>
      <div>
        {tab === "installed" && <InstalledPane onBrowse={() => setTab("discover")} />}
        {tab === "discover" && <DiscoverPane />}
        {tab === "usage" && <SkillUsagePane />}
      </div>
    </Section>
  );
}
