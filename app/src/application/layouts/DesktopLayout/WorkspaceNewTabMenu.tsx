import { setBrowserWebviewsSuspended } from "@/features/browser";
import type { WorkspaceSurfaceId } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  Blocks,
  Bot,
  Code2,
  FolderOpen,
  Download,
  Globe2,
  Plus,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";

export interface NewTabOption {
  surfaceId: WorkspaceSurfaceId;
  label: string;
  route: string;
  icon: LucideIcon;
  instancePolicy?: "single" | "multiple";
}

// The "+" menu always opens a fresh instance for surfaces that can meaningfully
// have more than one tab. Agents / Extensions stay singleton because they only
// make sense as one surface per app. Nav-rail clicks and URL restoration still
// reuse the last-used tab via routeSurface.ts.
export const NEW_TAB_OPTIONS: NewTabOption[] = [
  { surfaceId: "browser", label: "Browser tab", route: "/browser", icon: Globe2 },
  {
    surfaceId: "code",
    label: "Code",
    route: "/code",
    icon: Code2,
    instancePolicy: "single",
  },
  { surfaceId: "files", label: "Files", route: "/files", icon: FolderOpen },
  { surfaceId: "transfers", label: "Transfers", route: "/transfers", icon: Download },
  { surfaceId: "terminal", label: "Terminal", route: "/terminal", icon: SquareTerminal },
  {
    surfaceId: "agents",
    label: "Agents",
    route: "/agents",
    icon: Bot,
    instancePolicy: "single",
  },
  {
    surfaceId: "extensions",
    label: "Extensions",
    route: "/extensions",
    icon: Blocks,
    instancePolicy: "single",
  },
];

interface Props {
  paneId: string;
  onOpenNewTab: (option: NewTabOption, paneId: string) => void;
}

export function WorkspaceNewTabMenu({ paneId, onOpenNewTab }: Props) {
  const popupSuspensionReason = `workspace-new-tab-menu:${paneId}`;
  useEffect(
    () => () => setBrowserWebviewsSuspended(false, popupSuspensionReason),
    [popupSuspensionReason],
  );
  return (
    <DropdownMenu onOpenChange={(open) => setBrowserWebviewsSuspended(open, popupSuspensionReason)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-7 place-items-center rounded text-cream-muted hover:bg-charcoal-card hover:text-cream"
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel>Open new…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NEW_TAB_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem
              key={option.surfaceId}
              onSelect={() => onOpenNewTab(option, paneId)}
              className="flex items-center gap-2"
            >
              <Icon size={14} className="text-cream-muted" />
              <span>{option.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
