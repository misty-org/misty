import { useState } from "react";
import { SkeletonDocument } from "@/shared/ui";

/** A refresh the person pressed: run it, and cover the roadmap with skeletons until it is back. */
export function useRoadmapRefresh(load: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };
  return [refreshing, refresh] as const;
}

export function RoadmapRefreshCover({ refreshing }: { refreshing: boolean }) {
  if (!refreshing) return null;
  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-charcoal-bg">
      <SkeletonDocument label="Roadmap" />
    </div>
  );
}
