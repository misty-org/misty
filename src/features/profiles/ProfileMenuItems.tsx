import { Globe, Palette, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import {
  firstProfileId,
  openProfile,
  useProfileWindowStore,
} from "@/features/workspace/profileWindow";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
} from "@/shared/ui";
import { useProfileDialogs, type ProfileDialog } from "./profileDialogStore";

/**
 * The profiles in the account menu: the list, with a checkmark on this window's, once a second
 * one exists; adding one; and this window's own name, color, sites and deletion. Choosing another
 * profile opens or focuses its window. Tabs never swap under this one.
 */
export function ProfileMenuItems() {
  const current = useProfileWindowStore((state) => state.profile);
  const profiles = useProfileWindowStore((state) => state.profiles);
  const incognito = useProfileWindowStore((state) => state.incognito);
  const show = useProfileDialogs((state) => state.show);
  if (incognito) return null;
  // The menu hands focus back as it closes, so a dialog opens after it.
  const later = (dialog: ProfileDialog) => () => window.setTimeout(() => show(dialog), 0);
  return (
    <>
      {profiles.length > 1 ? (
        <>
          <DropdownMenuLabel>Profiles</DropdownMenuLabel>
          {profiles.map((profile) => (
            <DropdownMenuCheckboxItem
              key={profile.id}
              checked={profile.id === current.id}
              onSelect={() => {
                if (profile.id !== current.id) void openProfile(profile.id).catch(() => undefined);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </>
      ) : null}
      <MenuItem icon={<Plus />} label="Add profile…" onSelect={later("create")} />
      <MenuSubmenu icon={<UserCog />} label="Edit this profile" width="md">
        <DropdownMenuLabel className="truncate">{current.name}</DropdownMenuLabel>
        <MenuItem icon={<Pencil />} label="Rename…" onSelect={later("rename")} />
        <MenuItem icon={<Palette />} label="Color…" onSelect={later("color")} />
        <MenuItem icon={<Globe />} label="Sites that open here…" onSelect={later("sites")} />
        {current.id === firstProfileId ? null : (
          <>
            <DropdownMenuSeparator />
            <MenuItem icon={<Trash2 />} label="Delete…" onSelect={later("delete")} />
          </>
        )}
      </MenuSubmenu>
      <DropdownMenuSeparator />
    </>
  );
}
