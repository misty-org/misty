import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { appIcons, Button, WorkspaceSectionLabel, SkeletonList } from "@/shared/ui";
import { Images, MessagesSquare, Notebook, PencilRuler } from "lucide-react";
import { SpaceSidebarLink } from "./spacePanel/SpaceSidebarLink";
import { useSpaceOverview } from "../useSpaceOverview";
import { useSpacePersonalItems } from "../useSpacePersonalItems";
import { spaceItemKeyFromRoute } from "../spaceItemRoute";

export function SpaceRecentNavigation({
  space,
  onNavigate,
}: {
  space: Space;
  onNavigate: (path: string) => void;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const data = useSpaceOverview(user?.id ?? "", space);
  const personal = useSpacePersonalItems(space.id);
  const [expanded, setExpanded] = useState(false);
  const activeKey = spaceItemKeyFromRoute(location.pathname + location.search, space.id);
  const byId = new Map(data.items.map((item) => [item.id, item]));
  const recent = personal.items
    .filter((item) => item.opened_at && byId.has(item.item_key))
    .sort((a, b) => Date.parse(b.opened_at!) - Date.parse(a.opened_at!));
  const icons = {
    task: appIcons.planner,
    file: Images,
    chat: MessagesSquare,
    drawing: PencilRuler,
    note: Notebook,
  };
  return (
    <section className="min-h-0 flex-1 overflow-y-auto" aria-label="Recent items">
      <WorkspaceSectionLabel className="mt-2">Recents</WorkspaceSectionLabel>
      <nav className="grid gap-1">
        {recent.slice(0, expanded ? undefined : 5).map((saved) => {
          const item = byId.get(saved.item_key)!;
          return (
            <SpaceSidebarLink
              key={item.id}
              icon={icons[item.kind]}
              label={item.title}
              active={activeKey === item.id}
              to={item.route}
              onNavigate={onNavigate}
            />
          );
        })}
      </nav>
      {personal.error || data.failed ? (
        <div role="alert" className="px-3 text-xs text-cream-muted">
          Recent items couldn’t load.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              personal.retry();
              data.retry();
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        !recent.length &&
        (data.loading || !personal.ready ? (
          <SkeletonList
            label="Recent items"
            rows={4}
            leading="icon"
            lines={1}
            rowClassName="px-3"
          />
        ) : (
          <p className="px-3 py-2 text-xs text-cream-muted">Items you open appear here.</p>
        ))
      )}
      {recent.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </section>
  );
}
