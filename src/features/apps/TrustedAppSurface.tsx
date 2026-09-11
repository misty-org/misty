import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { OfficialApp } from "@/api/apps";
import type { WorkspaceTab } from "@/features/workspace/model";
import { ErrorState } from "@/shared/ui";

export interface TrustedAppSurfaceProps {
  app: OfficialApp;
  space?: Space;
  tab?: WorkspaceTab;
  active?: boolean;
  route: string;
}

/** Desktop apps must use their verified downloadable package. */
export function TrustedAppSurface({ app }: TrustedAppSurfaceProps) {
  return (
    <ErrorState
      title={`${app.name} update required`}
      description="Open Discover to update this app to its downloadable package."
    />
  );
}
