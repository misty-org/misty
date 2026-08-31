import { cn } from "@/shared/ui";
import {
  ArrowLeftRight,
  BookOpenText,
  Bot,
  CheckSquare2,
  Code2,
  FolderOpen,
  Globe2,
  House,
  Inbox,
  MessagesSquare,
  Notebook,
  SquareTerminal,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceToolId } from "./useRecentToolsStore";

type WorkspaceAppIconSize = "picker" | "nav" | "marketplace";

const appIconDetails: Record<WorkspaceToolId, { icon: LucideIcon }> = {
  home: { icon: House },
  inbox: { icon: Inbox },
  social: { icon: MessagesSquare },
  journal: { icon: Notebook },
  files: { icon: FolderOpen },
  agents: { icon: Bot },
  planner: { icon: CheckSquare2 },
  library: { icon: BookOpenText },
  browser: { icon: Globe2 },
  code: { icon: Code2 },
  terminal: { icon: SquareTerminal },
  transfers: { icon: ArrowLeftRight },
  marketplace: { icon: Store },
};

/** Keeps top-level app identity neutral across navigation, Settings, and Store. */
export function workspaceAppIconColorClass(_appId: WorkspaceToolId): string {
  return "text-cream-bright";
}

const sizeDetails: Record<
  WorkspaceAppIconSize,
  { tileClass: string; iconSize: number; strokeWidth: number }
> = {
  picker: { tileClass: "size-5", iconSize: 15, strokeWidth: 2 },
  nav: { tileClass: "size-7", iconSize: 20, strokeWidth: 2 },
  marketplace: { tileClass: "size-10", iconSize: 22, strokeWidth: 1.9 },
};

export function WorkspaceAppIcon(props: {
  appId: WorkspaceToolId;
  size?: WorkspaceAppIconSize;
  className?: string;
}) {
  const details = appIconDetails[props.appId];
  const size = props.size ?? "nav";
  const sizing = sizeDetails[size];
  const Icon = details.icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center",
        workspaceAppIconColorClass(props.appId),
        sizing.tileClass,
        props.className,
      )}
      data-app-icon={props.appId}
    >
      <Icon
        className={size === "nav" ? "!size-5" : undefined}
        size={sizing.iconSize}
        strokeWidth={sizing.strokeWidth}
      />
    </span>
  );
}
