export type WorkspaceRouteSurface = "code" | "terminal" | "transfers" | "files";

export interface OpenWorkspaceRouteRequest {
  requestId: string;
  route: string;
  surface: WorkspaceRouteSurface;
  sentAt: string;
  sourceDeviceId: string;
  sourceDeviceName: string;
}
