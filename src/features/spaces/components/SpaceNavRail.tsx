import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { LockKeyhole, Plus } from "lucide-react";
import { cn } from "@/ui";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { invitedSpacePreview } from "../spaceInvitation";
import { SpaceAvatar } from "./SpaceAvatar";

const validRailSections = new Set(["chat", "planner", "notes", "drawings", "library"]);
const spaceOrderStorageKey = "misty:space-nav-order:v1";

export function SpaceNavRail() {
  const location = useLocation();
  const spaces = useSpacesStore((state) => state.spaces);
  const invitations = useSpacesStore((state) => state.invitations);
  const limits = useSpacesStore((state) => state.limits);
  const [spaceOrder, setSpaceOrder] = useState(readSpaceOrder);
  const [draggedSpaceId, setDraggedSpaceId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const suppressClickRef = useRef(false);
  const activeSpaceId = activeSpaceIdFromPath(location.pathname);
  const userSpaceCount = spaces.length;
  const canAddSpace = !limits || limits.unlimited_spaces || userSpaceCount < limits.space_limit;
  const invitationBySpaceId = useMemo(
    () =>
      new Map(
        invitations
          .filter((invitation) => !spaces.some((space) => space.id === invitation.space_id))
          .map((invitation) => [invitation.space_id, invitation]),
      ),
    [invitations, spaces],
  );
  const railSpaces = useMemo(
    () => [
      ...spaces,
      ...invitations
        .filter((invitation) => !spaces.some((space) => space.id === invitation.space_id))
        .map(invitedSpacePreview),
    ],
    [invitations, spaces],
  );
  const orderedSpaces = useMemo(
    () => orderSpaces(railSpaces, spaceOrder),
    [railSpaces, spaceOrder],
  );

  const finishDrag = () => {
    setDraggedSpaceId("");
    setDropTargetId("");
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const dropSpace = (event: DragEvent<HTMLAnchorElement>, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData("application/x-misty-space") || draggedSpaceId;
    if (!sourceId || sourceId === targetId) return void finishDrag();
    const bounds = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY >= bounds.top + bounds.height / 2;
    const currentOrder = orderedSpaces.map((space) => space.id);
    const nextOrder = reorderSpaceIds(currentOrder, sourceId, targetId, insertAfter);
    setSpaceOrder(nextOrder);
    writeSpaceOrder(nextOrder);
    finishDrag();
  };

  return (
    <nav className="grid w-full justify-items-center gap-1.5" aria-label="Spaces">
      {orderedSpaces.map((space) => {
        const active = space.id === activeSpaceId;
        const invitation = invitationBySpaceId.get(space.id);
        return (
          <Link
            key={space.id}
            className={spaceRailLinkClass(active, dropTargetId === space.id)}
            to={
              invitation
                ? `/spaces/${encodeURIComponent(space.id)}/invitation`
                : spaceDestination(location.pathname, space.id)
            }
            state={{ mistySpaceSwitch: true }}
            aria-label={`${space.name} Space${invitation ? " invitation" : ""}`}
            aria-current={active ? "page" : undefined}
            title={invitation ? `${space.name} — invitation pending` : space.name}
            data-invitation-pending={invitation ? "true" : undefined}
            draggable
            data-misty-window-drag-block="true"
            data-reorder-drag-source="true"
            onClick={(event) => {
              if (!suppressClickRef.current) return;
              event.preventDefault();
            }}
            onDragStart={(event) => {
              suppressClickRef.current = true;
              setDraggedSpaceId(space.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-misty-space", space.id);
              event.dataTransfer.setData("text/plain", space.id);
            }}
            onDragEnter={() => {
              if (draggedSpaceId && draggedSpaceId !== space.id) setDropTargetId(space.id);
            }}
            onDragOver={(event) => {
              if (!draggedSpaceId || draggedSpaceId === space.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetId(space.id);
            }}
            onDrop={(event) => dropSpace(event, space.id)}
            onDragEnd={finishDrag}
          >
            <SpaceAvatar
              space={space}
              className={cn(
                "size-9 transition duration-150",
                active
                  ? "ring-2 ring-foreground/70 group-hover/space:ring-foreground/70"
                  : "ring-1 ring-border/55 group-hover/space:ring-border",
                "group-focus-visible/space:ring-ring",
              )}
            />
            {invitation ? (
              <span className="absolute bottom-1 right-1 grid size-4 place-items-center rounded-full border border-background bg-foreground text-background">
                <LockKeyhole className="size-2.5" strokeWidth={2.2} aria-hidden="true" />
                <span className="sr-only">Invitation pending</span>
              </span>
            ) : null}
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

function spaceRailLinkClass(active: boolean, dropTarget: boolean): string {
  return cn(
    "group/space relative grid size-[50px] shrink-0 place-items-center rounded-full bg-transparent outline-none",
    "transition-all",
    "focus-visible:ring-2 focus-visible:ring-ring",
    active && "text-foreground",
    dropTarget &&
      "after:pointer-events-none after:absolute after:-top-0.5 after:h-0.5 after:w-8 after:rounded-full after:bg-foreground after:content-['']",
  );
}

function orderSpaces(spaces: Space[], order: string[]): Space[] {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  return [
    ...order.flatMap((id) => {
      const space = byId.get(id);
      if (!space) return [];
      byId.delete(id);
      return [space];
    }),
    ...spaces.filter((space) => byId.has(space.id)),
  ];
}

export function reorderSpaceIds(
  order: string[],
  sourceId: string,
  targetId: string,
  insertAfter = false,
): string[] {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return order;
  const next = order.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourceId);
  return next;
}

function readSpaceOrder(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(spaceOrderStorageKey) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeSpaceOrder(order: string[]) {
  try {
    window.localStorage.setItem(spaceOrderStorageKey, JSON.stringify(order));
  } catch {
    // Space ordering is a local preference; dragging still works without storage.
  }
}
