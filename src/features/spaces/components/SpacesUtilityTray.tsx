import {
  ArrowRightLeft,
  Blocks,
  Bot,
  FolderOpen,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/ui";
import type { WorkspaceTabKind } from "@/stores/spaces/useSpacesTabsStore";

const utilityButtonClass = [
  "relative grid h-[26px] w-[30px] place-items-center rounded-md border-0 bg-transparent p-0",
  "text-cream-muted hover:bg-transparent hover:text-cream",
  "focus-visible:ring-2 focus-visible:ring-charcoal-active",
].join(" ");

export const workspaceToolDefinitions: ReadonlyArray<{
  kind: WorkspaceTabKind;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    kind: "space",
    label: "Space",
    description: "Journal, Planner, Chat, and Library",
    icon: PanelsTopLeft,
  },
  {
    kind: "file-manager",
    label: "File Manager",
    description: "Browse local and connected files",
    icon: FolderOpen,
  },
  {
    kind: "agents",
    label: "Agents",
    description: "Work with Misty and your Agent teammates",
    icon: Bot,
  },
  {
    kind: "extensions",
    label: "Extensions",
    description: "Browse and manage Misty extensions",
    icon: Blocks,
  },
  {
    kind: "transfers",
    label: "Transfers",
    description: "View active and completed transfers",
    icon: ArrowRightLeft,
  },
] as const;

export function SpacesUtilityTray(props: { onOpenTool: (kind: WorkspaceTabKind) => void }) {
  return (
    <nav className="flex items-center gap-0.5" aria-label="Workspace tools">
      {workspaceToolDefinitions.map(({ kind, label, icon }) => (
        <span className="contents" key={kind}>
          <UtilityButton
            icon={icon}
            label={`Open ${label}`}
            onClick={() => props.onOpenTool(kind)}
          />
        </span>
      ))}
    </nav>
  );
}

function UtilityButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={utilityButtonClass}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
    </Button>
  );
}
