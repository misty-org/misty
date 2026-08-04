import { Link, useLocation } from "react-router-dom";
import { Plus } from "lucide-react";
import { cn } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpaceAvatar } from "./SpaceAvatar";

const validRailSections = new Set(["chat", "planner", "notes", "drawings", "library"]);

export function SpaceNavRail() {
  const location = useLocation();
  const spaces = useSpacesStore((state) => state.spaces);
  const limits = useSpacesStore((state) => state.limits);
  const activeSpaceId = activeSpaceIdFromPath(location.pathname);
  const userSpaceCount = spaces.filter((space) => space.kind !== "misty").length;
  const canAddSpace = !limits || limits.unlimited_spaces || userSpaceCount < limits.space_limit;

  return (
    <nav className="grid w-full justify-items-center gap-1.5" aria-label="Spaces">
      {[...spaces]
        .sort((left, right) => Number(right.kind === "misty") - Number(left.kind === "misty"))
        .map((space) => {
          const active = space.id === activeSpaceId;
          return (
            <Link
              key={space.id}
              className={spaceRailLinkClass(active)}
              to={spaceDestination(location.pathname, space.id)}
              state={{ mistySpaceSwitch: true }}
              aria-label={`${space.name} Space`}
              aria-current={active ? "page" : undefined}
              title={space.name}
            >
              <SpaceAvatar
                space={space}
                className={cn(
                  "size-9 ring-1 ring-border/55 transition duration-150",
                  "group-hover/space:ring-border group-focus-visible/space:ring-ring",
                  active && "ring-2 ring-primary/70",
                )}
              />
            </Link>
          );
        })}

      <span className="my-1 h-px w-7 bg-border/55" aria-hidden="true" />
      <Link
        className={cn(
          "grid size-[46px] shrink-0 place-items-center rounded-[14px] border border-border/55",
          "bg-transparent text-muted-foreground no-underline outline-none transition-all",
          "hover:border-border hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring",
          !canAddSpace && "pointer-events-none opacity-45",
        )}
        to="/spaces?createSpace=1"
        title={canAddSpace ? "Add Space" : "You’ve reached your Space limit"}
        aria-label="Add Space"
        aria-disabled={!canAddSpace || undefined}
        tabIndex={canAddSpace ? undefined : -1}
        onClick={(event) => {
          if (!canAddSpace) event.preventDefault();
        }}
      >
        <Plus size={19} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </nav>
  );
}

export function spaceDestination(pathname: string, spaceId: string): string {
  const encodedSpaceId = encodeURIComponent(spaceId);
  const base = `/spaces/${encodedSpaceId}`;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces") return base;

  const requestedSection = parts[2] === "files" ? "library" : parts[2];
  return requestedSection && validRailSections.has(requestedSection)
    ? `${base}/${requestedSection}`
    : base;
}

function activeSpaceIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return "";
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return "";
  }
}

function spaceRailLinkClass(active: boolean): string {
  return cn(
    "group/space grid size-[50px] shrink-0 place-items-center rounded-[15px] border outline-none",
    "border-transparent bg-transparent transition-all hover:border-border/55",
    "focus-visible:ring-2 focus-visible:ring-ring",
    active && "border-border/70",
  );
}
