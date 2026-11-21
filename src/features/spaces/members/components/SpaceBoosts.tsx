import { openOnWebsite } from "@/features/account";
import { reportSystemError } from "@/shared/platform/systemErrors";
import { Button, Text } from "@misty/ui";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { spaceRequest } from "../../api/api";

/** A Space's level on Misty Cloud, as GET /spaces/{id}/boosts answers it. */
export interface SpaceBoostsState {
  enabled: boolean;
  level?: { level: number; boosts: number; next_level_boosts: number };
}

/** Where a Space stands, in one line: its level, its Boosts, and what the next level needs. */
export function spaceLevelLine(level: NonNullable<SpaceBoostsState["level"]>): string {
  const name = level.level === 0 ? "Base level" : `Level ${level.level}`;
  const boosts = `${level.boosts} ${level.boosts === 1 ? "Boost" : "Boosts"}`;
  if (!level.next_level_boosts) return `${name} with ${boosts}`;
  return `${name} with ${boosts}, ${level.next_level_boosts - level.boosts} more for Level ${level.level + 1}`;
}

/**
 * The Space's level and a way to boost it, on a server with Space levels (Misty Cloud). A
 * self-hosted server has none, answers enabled false, and this shows nothing. Boosts are given
 * and bought on the website, in its Boosts settings for this Space, which opens signed in.
 */
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
    <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
      <Text as="p" tone="muted" className="m-0 text-xs">
        {spaceLevelLine(state.level)}
      </Text>
      <Button type="button" onClick={boost}>
        <Rocket /> Boost
      </Button>
    </div>
  );
}
