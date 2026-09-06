import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { AuthUser } from "@/features/auth/authSession";
import type { WorkspaceTab } from "@/features/workspace/model";

export interface OfficialAppPackageSession {
  appId: string;
  spaceId: string;
  scopes: string[];
  expiresAt: string;
}

export interface OfficialAppPackageMountProps {
  instanceId: string;
  session: OfficialAppPackageSession;
  user: AuthUser;
  space?: Space;
  tab?: WorkspaceTab;
  active: boolean;
  platform: "desktop" | "mobile";
  route: string;
  search: string;
  settingsDocument: Record<string, unknown>;
  resolvedTheme: "dark" | "light";
  onWorkspaceTabChange?: (tab: WorkspaceTab) => void;
}

export interface OfficialAppPackageMount {
  update: (props: OfficialAppPackageMountProps) => void;
  unmount: () => void;
}

export interface OfficialAppPackageDefinition {
  appId: string;
  mount: (element: HTMLElement, props: OfficialAppPackageMountProps) => OfficialAppPackageMount;
}
