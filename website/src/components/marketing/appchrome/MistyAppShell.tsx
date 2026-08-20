import type { ReactNode } from "react";
import { Blocks, Bot, FolderOpen, House } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppStatusBar } from "./AppWindow";

/** Mirrors `desktopNavItems` in app/src/application/routing/navigation.ts. */
const railItems = [
  { id: "home", label: "Home", Icon: House },
  { id: "files", label: "Files", Icon: FolderOpen },
  { id: "agents", label: "Agents", Icon: Bot },
  { id: "extensions", label: "Extensions", Icon: Blocks },
] as const;

export type RailId = (typeof railItems)[number]["id"];

const spaces = [
  { name: "Launch plan", members: 5 },
  { name: "Q3 brand film", members: 8 },
  { name: "Research", members: 3 },
];

const members = ["AM", "JR", "SK", "TL", "PN"];

function NavRail({ active }: { active: RailId }) {
  return (
    <nav
      aria-hidden="true"
      className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--app-border)] bg-[var(--app-workspace)] py-3 @md:flex"
    >
      {railItems.map(({ id, Icon }) => (
        <span
          key={id}
          className={cn(
            "grid size-8 place-items-center rounded-lg",
            id === active
              ? "bg-[var(--app-hover)] text-[var(--app-ink-bright)]"
              : "text-[var(--app-ink-muted)]",
          )}
        >
          <Icon className="size-[17px]" strokeWidth={1.85} />
        </span>
      ))}
      <span className="mt-auto grid size-8 place-items-center rounded-full bg-[var(--app-active)] text-[10px] font-semibold text-[var(--app-ink-bright)]">
        AM
      </span>
    </nav>
  );
}

function SpacesSidebar({ activeSpace }: { activeSpace: string }) {
  return (
    <aside
      aria-hidden="true"
      className="hidden w-[168px] shrink-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-sidebar)] p-2.5 @2xl:flex"
    >
      <p className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
        Spaces
      </p>
      {spaces.map((space) => (
        <span
          key={space.name}
          className={cn(
            "mt-0.5 flex items-center gap-2 truncate rounded-md px-2 py-[7px] text-[12px]",
            space.name === activeSpace
              ? "bg-[var(--app-hover)] font-medium text-[var(--app-ink-bright)]"
              : "text-[var(--app-ink-muted)]",
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              space.name === activeSpace
                ? "bg-[#28c840]"
                : "bg-[var(--app-active)]",
            )}
          />
          <span className="truncate">{space.name}</span>
        </span>
      ))}

      <p className="mt-5 px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-ink-muted)]">
        Members
      </p>
      <div className="flex px-2">
        {members.map((initials, index) => (
          <span
            key={initials}
            className="grid size-6 place-items-center rounded-full bg-[var(--app-active)] text-[9px] font-semibold text-[var(--app-ink-bright)] ring-2 ring-[var(--app-sidebar)]"
            style={{ marginLeft: index === 0 ? 0 : -6 }}
          >
            {initials}
          </span>
        ))}
      </div>
    </aside>
  );
}

/**
 * The window interior: rail, Spaces sidebar, the active surface, status bar.
 *
 * `status` is deliberately a required prop. The status bar is where a Misty
 * mockup says what is private and what is shared, and a mockup that skips it
 * loses the one line doing the actual arguing.
 */
export function MistyAppShell({
  rail,
  activeSpace,
  status,
  children,
  className,
}: {
  rail: RailId;
  activeSpace: string;
  status: { left: ReactNode; right: ReactNode };
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className={cn("flex min-h-0", className)}>
        <NavRail active={rail} />
        <SpacesSidebar activeSpace={activeSpace} />
        <div className="flex min-w-0 flex-1 flex-col bg-[var(--app-bg)]">
          {children}
        </div>
      </div>
      <AppStatusBar left={status.left} right={status.right} />
    </div>
  );
}
