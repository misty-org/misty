import { openOnWebsite } from "@/features/account";
import { reportSystemError } from "@/shared/platform/system_errors";
import { Button, Text } from "@misty/ui";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { spaceRequest } from "../../api/api";

export interface SpaceBoostsState {
  enabled: boolean;
  level?: { level: number; boosts: number; next_level_boosts: number };
}

export function spaceLevelLine(level: NonNullable<SpaceBoostsState["level"]>): string {
  const name = level.level === 0 ? "Base level" : `Level ${level.level}`;
  const boosts = `${level.boosts} ${level.boosts === 1 ? "Boost" : "Boosts"}`;
  if (!level.next_level_boosts) return `${name} with ${boosts}`;
  return `${name} with ${boosts}, ${level.next_level_boosts - level.boosts} more for Level ${level.level + 1}`;
}

export function SpaceBoosts({ spaceId }: { spaceId: string }) {
  const [state, setState] = useState<SpaceBoostsState | null>(null);

  useEffect(() => {
    let live = true;
    spaceRequest<SpaceBoostsState>(`/spaces/${encodeURIComponent(spaceId)}/boosts`).then(
      (answer) => {
        if (live) setState(answer);
      },
      () => {
        if (live) setState(null);
      },
    );
    return () => {
      live = false;
    };
  }, [spaceId]);

  if (!state?.enabled || !state.level) return null;

  const boost = () =>
    void openOnWebsite(`/settings/boosts?space=${encodeURIComponent(spaceId)}`).catch(
      (error: unknown) => {
        reportSystemError({ scope: "spaces:boost", title: "Boosts could not be opened", error });
      },
    );

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <Text as="p" size="meta" tone="muted" className="m-0">
        {spaceLevelLine(state.level)}
      </Text>
      <Button type="button" icon={Rocket} onClick={boost}>
        Boost
      </Button>
    </div>
  );
}
