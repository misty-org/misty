import type { SpacePageSection } from "@/models/types/features/spaces/components/SpacePageLayout";
export type { SpacePageSection } from "@/models/types/features/spaces/components/SpacePageLayout";
import type { HTMLAttributes, ReactNode } from "react";
import {
  BookOpenText,
  Bot,
  CheckSquare2,
  MessagesSquare,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/ui";

const pageMetadata: Record<SpacePageSection, { title: string; icon: LucideIcon }> = {
  chat: { title: "Chat", icon: MessagesSquare },
  agents: { title: "Agents", icon: Bot },
  tasks: { title: "Tasks", icon: CheckSquare2 },
  library: { title: "Library", icon: BookOpenText },
  members: { title: "Members", icon: Users },
  settings: { title: "Settings", icon: Settings2 },
};

export function SpacePageFrame({
  section,
  spaceName,
  actions,
  children,
  className,
}: {
  section: string;
  spaceName?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const normalizedSection = normalizeSpacePageSection(section);
  const metadata = pageMetadata[normalizedSection];

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      <SpacePageHeader
        title={metadata.title}
        description={spaceName || "Space"}
        icon={metadata.icon}
        actions={actions}
      />
      <SpacePageBody>{children}</SpacePageBody>
    </div>
  );
}

export function SpacePageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("shrink-0 border-b border-border/60 bg-background", className)}>
      <div className="flex min-h-12 min-w-0 items-center gap-3 px-4 py-2">
        {Icon ? (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground"
            aria-hidden="true"
          >
            <Icon size={18} strokeWidth={1.8} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-6 text-foreground">{title}</h1>
          {description ? (
            <p className="truncate text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SpacePageBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1 overflow-hidden bg-background p-0", className)}
      {...props}
    />
  );
}

function normalizeSpacePageSection(section: string): SpacePageSection {
  if (section === "files") return "library";
  if (section === "studio") return "agents";
  return section in pageMetadata ? (section as SpacePageSection) : "chat";
}
