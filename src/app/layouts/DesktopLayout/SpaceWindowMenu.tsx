import { useState } from "react";
import { AppWindow, Palette, VenetianMask, X } from "lucide-react";
import { useSpacesStore } from "@/features/spaces/core";
import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import {
  closeSpaceWindow,
  isIncognitoWindow,
  openIncognitoWindow,
  openSpaceWindow,
  setSpaceColor,
  spaceWindow,
  useSpaceWindowStore,
} from "@/features/workspace/spaceWindow";
import { windowColorHex, windowColorNames } from "@/features/workspace/windowColors";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { BrowserProfileDialog, BrowserProfileMenu, type ProfileEdit } from "./BrowserProfileMenu";

const spaceColorLabel = "Space color";
const colorLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The window's Space menu: the account's Spaces (each opens in its own window, with
 * a checkmark on this one), a new incognito window, this Space's color and Close window.
 * The rows go inside any dropdown content; the dialog sits outside so it outlives the menu.
 */
export function useSpaceWindowMenu() {
  const [error, setError] = useState("");
  const [profileEdit, setProfileEdit] = useState<ProfileEdit | null>(null);
  const spaces = useSpacesStore((state) => state.spaces);
  const space = useSpaceWindowStore((state) => state.space);
  const current = spaceWindow();
  const personal = preferredDefaultSpace(spaces);
  const incognito = isIncognitoWindow();
  const report = (action: Promise<unknown>) =>
    void action.then(
      () => setError(""),
      () => setError("That window couldn't open. Try again."),
    );
  const dialog = <BrowserProfileDialog editing={profileEdit} onChange={setProfileEdit} />;
  const items = (
    <>
      {incognito ? null : (
        <>
          <BrowserProfileMenu onError={setError} onEdit={setProfileEdit} />
          <DropdownMenuSeparator />
        </>
      )}
      {spaces.map((item) => {
        const isPersonal = item.id === personal?.id;
        const here = isPersonal ? current.personal : item.id === current.spaceId;
        return (
          <DropdownMenuCheckboxItem
            key={item.id}
            checked={here}
            onSelect={() => report(openSpaceWindow(item.id, isPersonal))}
          >
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </DropdownMenuCheckboxItem>
        );
      })}
      {error && (
        <p role="alert" className="p-2 text-xs text-cream">
          {error}
        </p>
      )}
      <DropdownMenuSeparator />
      <MenuItem
        icon={<VenetianMask className="size-4" />}
        label="New incognito window"
        onSelect={() => report(openIncognitoWindow())}
      />
      {incognito ? null : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="size-4" />
            <span className="min-w-0 flex-1 truncate">{spaceColorLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 max-w-[calc(100vw-16px)]">
            {windowColorNames.map((name) => (
              <DropdownMenuCheckboxItem
                key={name}
                checked={space?.color === name}
                onSelect={() => report(setSpaceColor(name))}
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: windowColorHex(name) }}
                />
                <span className="min-w-0 flex-1 truncate">{colorLabel(name)}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <MenuItem
        icon={<X className="size-4" />}
        label="Close window"
        onSelect={() => window.setTimeout(() => void closeSpaceWindow(), 0)}
      />
    </>
  );
  return { dialog, items };
}

/** The Space menu as its own button, for the Windows title bar. */
export function SpaceWindowMenu() {
  const { dialog, items } = useSpaceWindowMenu();
  return (
    <>
      {dialog}
      <DropdownMenu>
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-charcoal-border" />
        <MenuTrigger
          iconOnly
          showChevron
          size="xs"
          label="Spaces"
          title="Spaces"
          icon={<AppWindow className="size-4" />}
        />
        <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-16px)]">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
