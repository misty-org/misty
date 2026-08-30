import type { SocialProviderId } from "@/api/social";
import { LoadingState } from "@/shared/ui";
import { lazy, Suspense } from "react";

const SpaceSocialImplementation = lazy(() =>
  import("./SpaceChat").then((module) => ({ default: module.SpaceSocial })),
);

export function SpaceSocial(props: {
  spaceId: string;
  spaceName: string;
  provider: SocialProviderId;
  workspaceTabId?: string;
}) {
  return (
    <Suspense
      fallback={<LoadingState className="h-full" label="Loading Social" title="Loading Social" />}
    >
      <SpaceSocialImplementation {...props} />
    </Suspense>
  );
}

/** Compatibility export for extensions compiled against the old component. */
export const SpaceChat = SpaceSocial;
