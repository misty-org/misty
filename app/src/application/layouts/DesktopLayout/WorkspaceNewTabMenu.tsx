import { useAuth } from "@/features/auth";
import { rememberedJournalRoute, rememberedPlannerRoute, useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore, type WorkspaceSurfaceId } from "@/features/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  ArrowLeftRight,
  Blocks,
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
  Plus,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface NewTabOption {
  surfaceId: WorkspaceSurfaceId;
  label: string;
  route: string;
  icon: LucideIcon;
  instancePolicy?: "single" | "multiple";
}

export const GENERAL_TAB_OPTIONS: NewTabOption[] = [
  { surfaceId: "home", label: "Home", route: "/home", icon: House },
  {
    surfaceId: "inbox",
    label: "Inbox",
    route: "/inbox",
    icon: Inbox,
    instancePolicy: "single",
  },
  { surfaceId: "browser", label: "Browser", route: "/browser", icon: Globe2 },
  {
    surfaceId: "code",
    label: "Code",
    route: "/code",
    icon: Code2,
    instancePolicy: "multiple",
  },
  { surfaceId: "files", label: "Files", route: "/files", icon: FolderOpen },
  {
    surfaceId: "transfers",
    label: "Transfers",
    route: "/transfers",
    icon: ArrowLeftRight,
    instancePolicy: "single",
  },
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

export const NEW_TAB_OPTIONS: NewTabOption[] = GENERAL_TAB_OPTIONS;

interface Props {
  paneId: string;
  onOpenNewTab: (option: NewTabOption, paneId: string) => void;
}

export function WorkspaceNewTabMenu({ paneId, onOpenNewTab }: Props) {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openPicker = (event: Event) => {
      if ((event as CustomEvent<{ paneId?: string }>).detail?.paneId === paneId) setOpen(true);
    };
    window.addEventListener("misty:open-new-tab-picker", openPicker);
    return () => window.removeEventListener("misty:open-new-tab-picker", openPicker);
  }, [paneId]);

  const activeSpace = useMemo(() => {
    const activeSpaceId = activeScopeKey.startsWith("space:") ? activeScopeKey.slice(6) : "";
    return spaces.find((s) => s.id === activeSpaceId) ?? spaces[0];
  }, [activeScopeKey, spaces]);

  const spaceTabOptions = useMemo<NewTabOption[]>(() => {
    const accountId = user?.id ?? "";
    if (!activeSpace) {
      return [
        { surfaceId: "space", label: "Journal", route: "/spaces", icon: Notebook },
        { surfaceId: "space", label: "Planner", route: "/spaces", icon: CheckSquare2 },
        { surfaceId: "space", label: "Chat", route: "/spaces", icon: MessagesSquare },
        { surfaceId: "space", label: "Library", route: "/spaces", icon: BookOpenText },
      ];
    }
    const encodedId = encodeURIComponent(activeSpace.id);
    return [
      {
        surfaceId: "space",
        label: "Journal",
        route: rememberedJournalRoute(accountId, activeSpace.id),
        icon: Notebook,
      },
      {
        surfaceId: "space",
        label: "Planner",
        route: rememberedPlannerRoute(accountId, activeSpace.id),
        icon: CheckSquare2,
      },
      {
        surfaceId: "space",
        label: "Chat",
        route: `/spaces/${encodedId}/chat`,
        icon: MessagesSquare,
      },
      {
        surfaceId: "space",
        label: "Library",
        route: `/spaces/${encodedId}/library`,
        icon: BookOpenText,
      },
    ];
  }, [activeSpace, user?.id]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-7 place-items-center rounded text-cream-muted outline-none hover:bg-charcoal-card hover:text-cream focus:outline-none"
          aria-label="New tab"
          title="New tab"
        >
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {[...GENERAL_TAB_OPTIONS, ...spaceTabOptions].map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem
              key={`${option.surfaceId}:${option.label}`}
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
