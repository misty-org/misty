import { Check, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { CommandGroup, CommandItem } from "@/shared/ui";
import { GlobalCreateSpaceDialog } from "../GlobalCreateSpaceDialog";
import { spaceNavigationName } from "../defaultSpace";
import { spaceLandingRoute } from "../navigation";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceAvatar } from "./SpaceAvatar";

/** The user's Spaces as a Command group, for the app launcher: open one, or create another. */
export function SpacesLauncherList(props: { activeSpaceId?: string; onChoose?: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  return (
    <GlobalCreateSpaceDialog>
      {(create) => (
        <CommandGroup heading="Spaces">
          {spaces.map((space) => (
            <CommandItem
              key={space.id}
              value={`space:${space.id}`}
              onSelect={() => {
                const surface = workspaceSurfaceFromRoute(spaceLandingRoute(space.id, user?.id));
                if (!surface) return;
                navigate(useWorkspaceStore.getState().openDestination(surface).route, {
                  replace: true,
                });
                props.onChoose?.();
              }}
            >
              <span className="size-6 shrink-0">
                <SpaceAvatar space={space} className="size-6" />
              </span>
              <span className="min-w-0 flex-1 truncate">{spaceNavigationName(space)}</span>
              {space.id === props.activeSpaceId ? <Check aria-label="Current Space" /> : null}
            </CommandItem>
          ))}
          <CommandItem
            value="create-space"
            onSelect={() => {
              props.onChoose?.();
              window.setTimeout(create, 0);
            }}
          >
            <Plus />
            Create Space
          </CommandItem>
        </CommandGroup>
      )}
    </GlobalCreateSpaceDialog>
  );
}
