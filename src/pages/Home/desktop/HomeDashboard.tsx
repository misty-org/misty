import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Blocks,
  BookOpenText,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  ExternalLink,
  FolderOpen,
  MessagesSquare,
  NotebookPen,
  Settings2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { spaceNotesEnabled } from "@/features/notes/availability";
import { openExternalLink } from "@/platform/openExternalLink";
import { routes } from "@/routing/paths";
import { Badge, Button, Card, Skeleton, cn } from "@/ui";

const betaWebsiteUrl = "https://mistysys.com";

type DashboardDestination = {
  badge?: string;
  detail: string;
  icon: LucideIcon;
  label: string;
  to: string;
};

export function HomeDashboard({
  loading,
  signedIn,
  spaces,
}: {
  loading: boolean;
  signedIn: boolean;
  spaces: Space[];
}) {
  const orderedSpaces = [...spaces].sort(compareSpaces);
  const contentSpace = orderedSpaces[0];
  const chatSpace = orderedSpaces.find((space) => space.permissions?.["messages.read"] !== false);
  const spacePages = buildSpacePages(contentSpace, chatSpace);
  const spaceManagement = buildSpaceManagement(contentSpace);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent text-foreground">
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5 max-[720px]:p-4"
        data-slot="home-dashboard-viewport"
      >
        <div
          aria-label="Home dashboard"
          className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[repeat(3,minmax(0,1fr))] grid-rows-[minmax(0,1fr)] items-stretch gap-4 max-[1180px]:grid-cols-2 max-[1180px]:grid-rows-[minmax(0,2fr)_minmax(0,1fr)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[repeat(3,minmax(0,1fr))]"
          role="region"
        >
          <div className="grid min-h-0 min-w-0 grid-rows-2 gap-4">
            <DashboardCard
              icon={BriefcaseBusiness}
              title="Your Spaces"
              detail="Open a Space and continue where you left off."
            >
              <SpaceRows loading={loading} signedIn={signedIn} spaces={orderedSpaces} />
            </DashboardCard>

            <DashboardCard
              icon={FolderOpen}
              title="Files"
              detail="Bring local and cloud files into Misty."
            >
              <DestinationRows
                destinations={[
                  {
                    detail: "Browse local and connected cloud sources",
                    icon: FolderOpen,
                    label: "Open Files",
                    to: routes.files,
                  },
                  {
                    detail: "See active and completed file transfers",
                    icon: ArrowRight,
                    label: "Transfers",
                    to: routes.transfers,
                  },
                ]}
              />
            </DashboardCard>
          </div>

          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.65fr)_minmax(0,0.65fr)] gap-4">
            <DashboardCard
              icon={BookOpenText}
              title={contentSpace ? `Inside ${contentSpace.name}` : "Inside Spaces"}
              detail="Quick access to the pages available during beta."
            >
              {spacePages.length > 0 ? (
                <DestinationRows destinations={spacePages} />
              ) : (
                <DashboardEmpty
                  detail={
                    signedIn
                      ? "Create or join a Space to unlock Chat, Library, Notes, and Tasks."
                      : "Sign in to load your Space pages."
                  }
                  label={signedIn ? "No Spaces yet" : "Sign in to Misty"}
                  to={signedIn ? routes.spaces : routes.signIn}
                />
              )}
            </DashboardCard>

            <DashboardCard
              icon={SlidersHorizontal}
              title="Manage Space"
              detail="People and preferences for your active Space."
            >
              {spaceManagement.length > 0 ? (
                <DestinationRows destinations={spaceManagement} />
              ) : (
                <DashboardEmpty
                  detail="Open a Space to manage members and preferences."
                  label="Choose a Space"
                  to={routes.spaces}
                />
              )}
            </DashboardCard>
          </div>

          <div className="grid min-h-0 min-w-0 grid-rows-2 gap-4 max-[1180px]:col-span-2 max-[1180px]:grid-cols-2 max-[1180px]:grid-rows-1 max-[820px]:col-span-1 max-[820px]:grid-cols-1 max-[820px]:grid-rows-2">
            <DashboardCard icon={Bot} title="Coming in v0.2.0" detail="Estimated August 9, 2026.">
              <DestinationRows
                destinations={[
                  {
                    badge: "Coming soon",
                    detail: "Custom agents for repeat work",
                    icon: Bot,
                    label: "Agents",
                    to: routes.agents,
                  },
                  {
                    badge: "Coming soon",
                    detail: "Connect more tools to Misty",
                    icon: Blocks,
                    label: "Extensions",
                    to: routes.extensions,
                  },
                ]}
              />
            </DashboardCard>

            <DashboardCard
              icon={CalendarDays}
              title="Beta resources"
              detail="Release information and your Misty account."
            >
              <DestinationRows
                destinations={[
                  {
                    detail: "Profile, security, and account preferences",
                    icon: Users,
                    label: "Account",
                    to: routes.account,
                  },
                  {
                    detail: "Misty application preferences",
                    icon: Settings2,
                    label: "Settings",
                    to: routes.settings,
                  },
                ]}
              />
              <DashboardActionRow
                detail="Product details and beta updates"
                icon={ExternalLink}
                label="Misty website"
                onClick={() => void openExternalLink(betaWebsiteUrl)}
              />
            </DashboardCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpaceRows({
  loading,
  signedIn,
  spaces,
}: {
  loading: boolean;
  signedIn: boolean;
  spaces: Space[];
}) {
  if (loading && spaces.length === 0) {
    return (
      <div className="grid gap-1.5" aria-busy="true" role="status">
        <span className="sr-only">Loading Spaces</span>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton className="h-14 rounded-md" key={index} />
        ))}
      </div>
    );
  }

  if (spaces.length === 0) {
    return (
      <DashboardEmpty
        detail={
          signedIn
            ? "Start with a private Space, then invite people when you're ready."
            : "Sign in to see your Spaces."
        }
        label={signedIn ? "Create your first Space" : "Sign in to Misty"}
        to={signedIn ? routes.spaces : routes.signIn}
      />
    );
  }

  return (
    <div className="grid content-start gap-1">
      {spaces.map((space) => (
        <DashboardRow
          key={space.id}
          detail={`${space.member_count} ${space.member_count === 1 ? "member" : "members"}`}
          icon={BriefcaseBusiness}
          label={space.name}
          to={spacePath(space)}
        />
      ))}
    </div>
  );
}

function DestinationRows({ destinations }: { destinations: DashboardDestination[] }) {
  return (
    <div className="grid content-start gap-1">
      {destinations.map((destination) => (
        <DashboardRow key={`${destination.to}:${destination.label}`} {...destination} />
      ))}
    </div>
  );
}

function DashboardRow({ badge, detail, icon: Icon, label, to }: DashboardDestination) {
  return (
    <Link
      className="group/row grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-2 text-left no-underline outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      to={to}
    >
      <DashboardRowIcon icon={Icon} />
      <DashboardRowLabel detail={detail} label={label} />
      {badge ? (
        <Badge className="ml-1 max-w-24 truncate" variant="outline">
          {badge}
        </Badge>
      ) : null}
    </Link>
  );
}

function DashboardActionRow({
  detail,
  icon: Icon,
  label,
  onClick,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="group/row grid h-auto w-full min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center justify-start gap-2.5 px-2 py-2 text-left font-normal"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <DashboardRowIcon icon={Icon} />
      <DashboardRowLabel detail={detail} label={label} />
    </Button>
  );
}

function DashboardRowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover/row:text-foreground">
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

function DashboardRowLabel({ detail, label }: { detail: string; label: string }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-foreground">{label}</span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  );
}

function DashboardCard({
  children,
  className,
  detail,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  className?: string;
  detail: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Card className={cn("min-h-0 min-w-0 gap-0 !bg-transparent px-4 py-4", className)} size="sm">
      <section className="flex h-full min-h-0 min-w-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-border/60 pb-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span>
          </span>
        </header>
        <div
          className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pr-1"
          data-slot="dashboard-panel-scroll"
        >
          {children}
        </div>
      </section>
    </Card>
  );
}

function DashboardEmpty({ detail, label, to }: { detail: string; label: string; to: string }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-lg bg-muted/35 p-4">
      <span>
        <strong className="block text-sm font-medium">{label}</strong>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
      </span>
      <Button asChild size="sm" variant="outline">
        <Link to={to}>{to === routes.signIn ? "Sign in" : "Open Spaces"}</Link>
      </Button>
    </div>
  );
}

function buildSpacePages(contentSpace: Space | undefined, chatSpace: Space | undefined) {
  const destinations: DashboardDestination[] = [];
  if (chatSpace) {
    destinations.push({
      detail: chatSpace.name,
      icon: MessagesSquare,
      label: "Chat",
      to: `/spaces/${encodeURIComponent(chatSpace.id)}/chat`,
    });
  }
  if (!contentSpace) return destinations;
  if (contentSpace.permissions?.["library.view"] !== false) {
    destinations.push({
      detail: contentSpace.name,
      icon: BookOpenText,
      label: "Library",
      to: `/spaces/${encodeURIComponent(contentSpace.id)}/library`,
    });
    if (spaceNotesEnabled) {
      destinations.push({
        detail: contentSpace.name,
        icon: NotebookPen,
        label: "Notes",
        to: `/spaces/${encodeURIComponent(contentSpace.id)}/notes`,
      });
    }
  }
  if (contentSpace.permissions?.["tasks.view"] !== false) {
    destinations.push({
      detail: contentSpace.name,
      icon: CheckSquare2,
      label: "Tasks",
      to: `/spaces/${encodeURIComponent(contentSpace.id)}/tasks`,
    });
  }
  return destinations;
}

function buildSpaceManagement(contentSpace: Space | undefined) {
  if (!contentSpace) return [];
  const encodedSpaceId = encodeURIComponent(contentSpace.id);
  return [
    {
      detail: contentSpace.name,
      icon: Users,
      label: "Members",
      to: `/spaces/${encodedSpaceId}/members`,
    },
    {
      detail: contentSpace.name,
      icon: Settings2,
      label: "Space settings",
      to: `/spaces/${encodedSpaceId}/settings/general`,
    },
  ] satisfies DashboardDestination[];
}

function spacePath(space: Space) {
  const section = space.permissions?.["messages.read"] === false ? "library" : "chat";
  return `/spaces/${encodeURIComponent(space.id)}/${section}`;
}

function compareSpaces(left: Space, right: Space) {
  return (
    Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
    left.name.localeCompare(right.name)
  );
}
