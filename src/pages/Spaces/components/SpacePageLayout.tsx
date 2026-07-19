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
import { PageBody, PageHeader, PageShell } from "@/components/misty";
import { cn } from "@/lib/utils";

type SpacePageSection = "chat" | "agents" | "tasks" | "library" | "members" | "settings";

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
    <PageShell density="compact" className={className}>
      <SpacePageHeader
        title={metadata.title}
        description={spaceName || "Space"}
        icon={metadata.icon}
        actions={actions}
      />
      <SpacePageBody>{children}</SpacePageBody>
    </PageShell>
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
    <PageHeader
      className={className}
      title={title}
      description={description}
      leading={Icon ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8}/>
        </span>
      ) : undefined}
      actions={actions}
    />
  );
}

export function SpacePageBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <PageBody scrollable={false} className={cn("bg-background p-0 max-[720px]:p-0", className)} {...props}/>;
}

function normalizeSpacePageSection(section: string): SpacePageSection {
  if (section === "files") return "library";
  if (section === "studio") return "agents";
  return section in pageMetadata ? section as SpacePageSection : "chat";
}
