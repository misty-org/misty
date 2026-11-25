import { HardDrive, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavList, NavRow, OverflowFadeText, Text, spaceIcons } from "@misty/ui";
import { DesktopSettingsFrame } from "@/features/settings";
import type { Space } from "../api/dto/entities";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { spaceNavigationName } from "../routes/default_space";
import { spaceSettingsPages, type SpaceSettingsPage } from "./space_settings_pages";

const pageRows: Record<SpaceSettingsPage, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: spaceIcons.space },
  people: { label: "People", icon: UsersRound },
  roles: { label: "Roles", icon: ShieldCheck },
  drive: { label: "Drive", icon: HardDrive },
};

export interface SpaceSettingsNav {
  space: Space;
  page: SpaceSettingsPage;
  onPage: (page: SpaceSettingsPage) => void;
  onClose: () => void;
}

export function SpaceSettingsFrame(props: {
  nav: SpaceSettingsNav;
  title: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { space, page, onPage, onClose } = props.nav;
  const name = spaceNavigationName(space);
  return (
    <DesktopSettingsFrame
      presentation="overlay"
      ariaLabel={`${name} settings`}
      navigationLabel="Space settings"
      groups={[]}
      activeId={page}
      onSelect={onPage}
      onClose={onClose}
      title={props.title}
      back={props.back}
      actions={props.actions}
      navigationHeader={
        <div className="flex min-w-0 items-center gap-2 pl-1.5">
          <SpaceAvatar
            space={space}
            className="size-6 shrink-0 rounded-md"
            fallbackClassName="text-micro font-semibold"
          />
          <Text weight="semibold" tone="bright">
            {name}
          </Text>
        </div>
      }
      navigationOverride={
        <nav
          aria-label="Space settings"
          className="misty-scrollbar min-h-0 flex-1 overflow-y-auto px-3"
        >
          <NavList>
            {spaceSettingsPages(space).map((each) => {
              const Icon = pageRows[each].icon;
              return (
                <NavRow
                  key={each}
                  tone="page"
                  current={each === page}
                  data-misty-window-drag-block="true"
                  onClick={() => onPage(each)}
                >
                  <Icon aria-hidden />
                  <OverflowFadeText>{pageRows[each].label}</OverflowFadeText>
                </NavRow>
              );
            })}
          </NavList>
        </nav>
      }
    >
      {props.children}
    </DesktopSettingsFrame>
  );
}
