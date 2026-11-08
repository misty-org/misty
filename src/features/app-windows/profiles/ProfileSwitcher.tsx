import { Globe, MoreHorizontal, Palette, Pencil, Trash2 } from "lucide-react";
import {
  firstProfileId,
  openProfile,
  useProfileWindowStore,
  type ProfileEntry,
} from "./profileWindow";
import {
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  toolbarIconProps,
} from "@/shared/ui";
import { useProfileDialogs, type ProfileDialog } from "./profileDialogStore";

const MOST_SHOWN = 5;

/** The buttons that fit, always including this window's, and the rest. */
export function splitProfiles(profiles: ProfileEntry[], currentId: string) {
  if (profiles.length <= MOST_SHOWN) return { shown: profiles, more: [] };
  const shown = profiles.slice(0, MOST_SHOWN - 1);
  if (!shown.some((profile) => profile.id === currentId)) {
    const current = profiles.find((profile) => profile.id === currentId);
    if (current) shown[shown.length - 1] = current;
  }
  return { shown, more: profiles.filter((profile) => !shown.includes(profile)) };
}

const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

const switchTo = (id: string) => void openProfile(id).catch(() => undefined);

function ProfileButton({ profile, current }: { profile: ProfileEntry; current: boolean }) {
  const show = useProfileDialogs((state) => state.show);
  // The menu hands focus back as it closes, so a dialog opens after it.
  const later = (dialog: ProfileDialog) => () =>
    window.setTimeout(() => show(dialog, profile.id), 0);
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <IconButton
          label={profile.name}
          shape="round"
          aria-pressed={current}
          onClick={current ? undefined : () => switchTo(profile.id)}
        >
          <span aria-hidden="true" className="text-xs font-medium">
            {initial(profile.name)}
          </span>
        </IconButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuAction icon={<Pencil />} label="Rename…" onSelect={later("rename")} />
        <ContextMenuAction icon={<Palette />} label="Color…" onSelect={later("color")} />
        <ContextMenuAction
          icon={<Globe />}
          label="Sites that open here…"
          onSelect={later("sites")}
        />
        {profile.id === firstProfileId ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuAction icon={<Trash2 />} label="Delete…" onSelect={later("delete")} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The sidebar's profile buttons. Choosing one opens or focuses that profile's window, and tabs
 * never swap under this one. With a single profile there's nothing to switch to, so it's hidden.
 */
export function ProfileSwitcher() {
  const profiles = useProfileWindowStore((state) => state.profiles);
  const currentId = useProfileWindowStore((state) => state.profile.id);
  const incognito = useProfileWindowStore((state) => state.incognito);
  if (incognito || profiles.length < 2) return null;
  const { shown, more } = splitProfiles(profiles, currentId);
  return (
    <div className="flex min-w-0 items-center gap-0.5" role="group" aria-label="Profiles">
      {shown.map((profile) => (
        <ProfileButton key={profile.id} profile={profile} current={profile.id === currentId} />
      ))}
      {more.length ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton label="More profiles" shape="round">
              <MoreHorizontal {...toolbarIconProps} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            {more.map((profile) => (
              <MenuItem
                key={profile.id}
                label={profile.name}
                onSelect={() => switchTo(profile.id)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
