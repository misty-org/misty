import type { Category, Section } from "../types";

import Introduction, { data as introduction } from "./Introduction";
import Installation, { data as installation } from "./Installation";
import Setup, { data as setup } from "./Setup";
import ProvidersOverview, { data as providersOverview } from "./ProvidersOverview";
import GoogleDrive, { data as googleDrive } from "./GoogleDrive";
import OneDrive, { data as oneDrive } from "./OneDrive";
import S3Sftp, { data as s3Sftp } from "./S3Sftp";
import BackupsOverview, { data as backupsOverview } from "./BackupsOverview";
import Snapshots, { data as snapshots } from "./Snapshots";
import Restore, { data as restore } from "./Restore";
import SearchOverview, { data as searchOverview } from "./SearchOverview";
import Indexing, { data as indexing } from "./Indexing";
import SearchWorkflows, { data as searchWorkflows } from "./SearchWorkflows";
import PluginsOverview, { data as pluginsOverview } from "./PluginsOverview";
import BuildingPlugins, { data as buildingPlugins } from "./BuildingPlugins";
import MistyAiOverview, { data as mistyAiOverview } from "./MistyAiOverview";
import AskMistyAi, { data as askMistyAi } from "./AskMistyAi";
import MistyAiActions, { data as mistyAiActions } from "./MistyAiActions";

export const guideSections: Section[] = [
  { ...introduction, Component: Introduction },
  { ...installation, Component: Installation },
  { ...setup, Component: Setup },
  { ...providersOverview, Component: ProvidersOverview },
  { ...googleDrive, Component: GoogleDrive },
  { ...oneDrive, Component: OneDrive },
  { ...s3Sftp, Component: S3Sftp },
  { ...backupsOverview, Component: BackupsOverview },
  { ...snapshots, Component: Snapshots },
  { ...restore, Component: Restore },
  { ...searchOverview, Component: SearchOverview },
  { ...indexing, Component: Indexing },
  { ...searchWorkflows, Component: SearchWorkflows },
  { ...pluginsOverview, Component: PluginsOverview },
  { ...buildingPlugins, Component: BuildingPlugins },
  { ...mistyAiOverview, Component: MistyAiOverview },
  { ...askMistyAi, Component: AskMistyAi },
  { ...mistyAiActions, Component: MistyAiActions },
];

const categoryLabels: Record<string, string> = {
  "getting-started": "Getting Started",
  providers: "Providers",
  backups: "Backups",
  search: "Search",
  plugins: "Plugins",
  mistyai: "MistyAI",
};

export const guideCategories: Category[] = Object.entries(categoryLabels).map(
  ([key, label]) => ({
    key,
    label,
    ids: guideSections
      .filter((section) => section.category === key)
      .map((section) => section.id),
  }),
);

export const defaultSectionId = guideSections[0].id;

export function getSectionById(id: string) {
  return guideSections.find((section) => section.id === id) ?? guideSections[0];
}

export function getSectionIndex(id: string) {
  const index = guideSections.findIndex((section) => section.id === id);
  return index === -1 ? 0 : index;
}

export function hasSection(id: string) {
  return guideSections.some((section) => section.id === id);
}
