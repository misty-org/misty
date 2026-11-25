import { WorkspaceOverlay } from "@misty/ui";
import type { Space } from "../api/dto/entities";
import { spaceNavigationName } from "../routes/default_space";
import { DrivePage } from "./DrivePage";
import { OverviewPage } from "./OverviewPage";
import { PeoplePage } from "./PeoplePage";
import { RolesPage } from "./RolesPage";
import type { SpaceSettingsNav } from "./SpaceSettingsFrame";
import { spaceSettingsPages, type SpaceSettingsPage } from "./space_settings_pages";

export function SpaceSettings(props: {
  space: Space;
  page: SpaceSettingsPage | null;
  onPage: (page: SpaceSettingsPage) => void;
  onClose: () => void;
}) {
  const name = spaceNavigationName(props.space);
  const pages = spaceSettingsPages(props.space);
  const page = props.page && pages.includes(props.page) ? props.page : pages[0];
  const nav: SpaceSettingsNav | null = page
    ? { space: props.space, page, onPage: props.onPage, onClose: props.onClose }
    : null;
  return (
    <WorkspaceOverlay
      open={Boolean(props.page && nav)}
      onClose={props.onClose}
      ariaLabel={`${name} settings`}
    >
      {nav ? <SpaceSettingsPageView nav={nav} /> : null}
    </WorkspaceOverlay>
  );
}

function SpaceSettingsPageView({ nav }: { nav: SpaceSettingsNav }) {
  if (nav.page === "overview") return <OverviewPage key={nav.space.id} nav={nav} />;
  if (nav.page === "people") return <PeoplePage key={nav.space.id} nav={nav} />;
  if (nav.page === "roles") return <RolesPage key={nav.space.id} nav={nav} />;
  return <DrivePage key={nav.space.id} nav={nav} />;
}
