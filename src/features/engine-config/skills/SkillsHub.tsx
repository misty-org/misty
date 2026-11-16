// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Agents › Skills: the skills hub across every engine.
 *
 * Two panes, each loading its own data only while it shows:
 *   My skills — installed and local skills, and which engines hold a copy (the default)
 *   Usage     — Claude Code invocation counts and the log of changes
 *
 * Finding new skills is each engine's Skills catalog on the Plugins page, which lists what the hub's
 * repositories hold and searches skills.sh; the repositories are managed from here.
 */
import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { DesktopSettingsSection as Section } from "@/features/settings";
import { Button, ChoiceGroup } from "@/shared/ui";
import { InstalledPane } from "./InstalledPane";
import { SkillReposDialog } from "./SkillReposDialog";
import { SkillUsagePane } from "./SkillUsagePane";
import { t } from "./strings";

type SkillTab = "installed" | "usage";

export function SkillsHub({ onBrowse }: { onBrowse: () => void }) {
  const [tab, setTab] = useState<SkillTab>("installed");
  const [reposOpen, setReposOpen] = useState(false);
  return (
    <Section title="Skills">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <ChoiceGroup
          label="Skills"
          value={tab}
          onChange={setTab}
          options={(["installed", "usage"] as const).map((id) => ({
            value: id,
            label: t(`tabs.${id}`),
          }))}
        />
        <Button icon={FolderGit2} onClick={() => setReposOpen(true)}>
          {t("discover.manageRepos")}
        </Button>
      </div>
      <div>
        {tab === "installed" && <InstalledPane onBrowse={onBrowse} />}
        {tab === "usage" && <SkillUsagePane />}
      </div>
      {reposOpen ? <SkillReposDialog onClose={() => setReposOpen(false)} /> : null}
    </Section>
  );
}
