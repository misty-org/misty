import { invoke } from "@tauri-apps/api/core";
import { Check, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { profileIdFromScope } from "@/features/workspace/browserProfiles";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { confirmAction } from "@/shared/lib/confirmAction";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Input,
  MenuSubmenu,
  Textarea,
} from "@/shared/ui";

/** Shows the profile's windows after a switch, the way a projection does. */
function showActiveWindow() {
  window.dispatchEvent(new Event("misty:workspace-projection-applied"));
}

export interface ProfileEdit {
  id: string | null;
  name: string;
  /** One site per line; links to them from other apps open in this profile. */
  sites: string;
}

function selectProfile(id: string | null) {
  if (useWorkspaceStore.getState().selectBrowserProfile(id)) showActiveWindow();
}

/**
 * Profiles on this device, in the virtual-window menu. Each has its own windows
 * and its own website sign-ins; the default profile is the account's synced one.
 */
export function BrowserProfileMenu(props: {
  onError(message: string): void;
  onEdit(edit: ProfileEdit): void;
}) {
  const profiles = useWorkspaceStore((state) => state.browserProfiles);
  const activeId = useWorkspaceStore((state) => profileIdFromScope(state.activeScopeKey));
  const active = profiles.find((profile) => profile.id === activeId);
  const select = selectProfile;
  const setEditing = props.onEdit;
  const remove = async () => {
    if (!active) return;
    const confirmed = await confirmAction(
      `Remove “${active.name}”? Its windows, tabs and website sign-ins on this device are deleted.`,
      "Remove profile",
    );
    if (!confirmed) return;
    const dataId = useWorkspaceStore.getState().removeBrowserProfile(active.id);
    showActiveWindow();
    if (dataId)
      await invoke("browser_device_profile_delete", { profileId: dataId }).catch(() =>
        props.onError("The profile was removed, but some of its website data could not be erased."),
      );
  };
  return (
    <>
      <MenuSubmenu
        icon={<UserRound className="size-4" />}
        label={`Profile: ${active?.name ?? "Default"}`}
      >
        <DropdownMenuItem onSelect={() => select(null)}>
          <span className="min-w-0 flex-1 truncate">Default</span>
          {!active ? <Check className="size-4" aria-label="Current profile" /> : null}
        </DropdownMenuItem>
        {profiles.map((profile) => (
          <DropdownMenuItem key={profile.id} onSelect={() => select(profile.id)}>
            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            {profile.id === activeId ? (
              <Check className="size-4" aria-label="Current profile" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setEditing({ id: null, name: "", sites: "" })}>
          <Plus className="size-4" />
          New profile…
        </DropdownMenuItem>
        {active ? (
          <>
            <DropdownMenuItem
              onSelect={() =>
                setEditing({
                  id: active.id,
                  name: active.name,
                  sites: (active.sites ?? []).join("\n"),
                })
              }
            >
              <Pencil className="size-4" />
              Edit profile…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void remove()}>
              <Trash2 className="size-4" />
              Remove profile…
            </DropdownMenuItem>
          </>
        ) : null}
      </MenuSubmenu>
    </>
  );
}

/** Names a new profile or renames one. Lives outside the menu, which closes first. */
export function BrowserProfileDialog(props: {
  editing: ProfileEdit | null;
  onChange(edit: ProfileEdit | null): void;
}) {
  const { editing } = props;
  const setEditing = props.onChange;
  return (
    <>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{editing?.id ? "Edit profile" : "New profile"}</DialogTitle>
          <DialogDescription>
            A profile has its own windows and its own website sign-ins. It stays on this device.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!editing) return;
              const store = useWorkspaceStore.getState();
              const id = editing.id ?? store.createBrowserProfile(editing.name).id;
              if (editing.id) store.renameBrowserProfile(id, editing.name);
              store.setBrowserProfileSites(id, editing.sites.split(/[\n,]/));
              if (!editing.id) selectProfile(id);
              setEditing(null);
            }}
          >
            <Input
              autoFocus
              aria-label="Profile name"
              placeholder="Work"
              maxLength={60}
              value={editing?.name ?? ""}
              onChange={(event) => setEditing({ ...editing!, name: event.target.value })}
            />
            <label className="mt-3 grid gap-1 text-sm">
              <span className="text-cream-muted">
                Open links to these sites from other apps here, one per line
              </span>
              <Textarea
                aria-label="Sites for this profile"
                rows={3}
                placeholder="mail.example.com"
                value={editing?.sites ?? ""}
                onChange={(event) => setEditing({ ...editing!, sites: event.target.value })}
              />
            </label>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">{editing?.id ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
