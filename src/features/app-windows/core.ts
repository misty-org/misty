// Core shell contract. Keep desktop-only multi-pane widgets out of this
// surface so account routes do not pull them into their bundles.
export * from "./panes/dockRegistry";
export * from "./panes/dockTree";
export * from "./tabs/MistyBrandIcon";
export * from "./tabs/workspaceViews";
export * from "./panes/paneNavigation";
export * from "./tabs/routeSurface";
export * from "./tabs/useWorkspaceStore";
export * from "./tabs/useWorkspaceViewTitle";
export * from "./tabs/WorkspaceAppIcon";
export * from "./tabs/workspaceDefaultView";
export * from "./tabs/workspaceViewOperations";
export * from "./tabs/WorkspaceViewRouteScope";
