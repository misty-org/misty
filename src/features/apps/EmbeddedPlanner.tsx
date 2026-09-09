import { ErrorState } from "@/shared/ui";
export interface EmbeddedPlannerProps {
  spaceId: string;
  canManage: boolean;
  canManageIntegrations: boolean;
  workspaceTabId?: string;
}
/** Desktop intentionally contains no Planner screen implementation. */
export function EmbeddedPlanner(_props: EmbeddedPlannerProps) {
  return (
    <ErrorState
      title="Planner update required"
      description="Open Discover to update Planner to its downloadable app package."
    />
  );
}
