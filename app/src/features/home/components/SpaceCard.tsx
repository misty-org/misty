import type { Space } from "@/api/spaces/dto/interfaces/types";
import { SpaceAvatar } from "@/features/spaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { Users } from "lucide-react";
import { Link } from "react-router-dom";
import { formatRelative } from "../homeFormat";

const spaceCardClass = [
  "h-full min-h-[112px] gap-3 border-charcoal-border bg-charcoal-card/80 transition-colors",
  "group-hover:border-charcoal-active group-focus-visible:ring-2",
  "group-focus-visible:ring-charcoal-active",
].join(" ");

export function SpaceCard(props: { space: Space; unreadCount: number }) {
  return (
    <Link to={`/spaces/${encodeURIComponent(props.space.id)}`} className="group outline-none">
      <Card size="sm" className={spaceCardClass}>
        <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <SpaceAvatar space={props.space} className="size-10 ring-1 ring-charcoal-border" />
          <div className="min-w-0">
            <CardTitle className="truncate text-sm text-cream-bright">{props.space.name}</CardTitle>
            <p className="mt-0.5 truncate text-xs text-cream-muted">
              Updated {formatRelative(props.space.updated_at)}
            </p>
          </div>
          {props.unreadCount ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-cream px-1.5 py-0.5 text-[10px] font-semibold text-charcoal-bg">
              {Math.min(props.unreadCount, 99)}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="flex items-center gap-1.5 text-xs text-cream-muted">
          <Users className="size-3.5" strokeWidth={1.8} />
          {props.space.member_count} member{props.space.member_count === 1 ? "" : "s"}
        </CardContent>
      </Card>
    </Link>
  );
}
